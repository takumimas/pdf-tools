import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile, mkdir } from "@tauri-apps/plugin-fs";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type Tool = "merge" | "split" | "pdfToJpeg" | "jpegToPdf" | "unlock";

interface PdfFile {
  path: string;
  name: string;
}

function App() {
  const [currentTool, setCurrentTool] = useState<Tool>("merge");
  const [pdfFiles, setPdfFiles] = useState<PdfFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");

  const tools = [
    { id: "merge" as Tool, name: "PDF結合", icon: "+" },
    { id: "split" as Tool, name: "PDF分割", icon: "✂" },
    { id: "pdfToJpeg" as Tool, name: "PDF→JPEG", icon: "🖼" },
    { id: "jpegToPdf" as Tool, name: "JPEG→PDF", icon: "📄" },
    { id: "unlock" as Tool, name: "パスワード解除", icon: "🔓" },
  ];

  const addFiles = async (extensions: string[] = ["pdf"], filterName = "PDF") => {
    const selected = await open({
      multiple: true,
      filters: [{ name: filterName, extensions }],
    });

    if (selected && Array.isArray(selected)) {
      const newFiles = selected.map((path) => ({
        path,
        name: path.split("/").pop() || path.split("\\").pop() || path,
      }));
      setPdfFiles((prev) => [...prev, ...newFiles]);
      setMessage("");
    }
  };

  const addSingleFile = async (extensions: string[] = ["pdf"], filterName = "PDF") => {
    const selected = await open({
      multiple: false,
      filters: [{ name: filterName, extensions }],
    });

    if (selected && typeof selected === "string") {
      const newFile = {
        path: selected,
        name: selected.split("/").pop() || selected.split("\\").pop() || selected,
      };
      setPdfFiles([newFile]);
      setMessage("");
    }
  };

  const removeFile = (index: number) => {
    setPdfFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const moveFile = (index: number, direction: "up" | "down") => {
    if (
      (direction === "up" && index === 0) ||
      (direction === "down" && index === pdfFiles.length - 1)
    ) {
      return;
    }
    const newFiles = [...pdfFiles];
    const newIndex = direction === "up" ? index - 1 : index + 1;
    [newFiles[index], newFiles[newIndex]] = [newFiles[newIndex], newFiles[index]];
    setPdfFiles(newFiles);
  };

  const clearAll = () => {
    setPdfFiles([]);
    setMessage("");
    setPassword("");
  };

  const handleToolChange = (tool: Tool) => {
    setCurrentTool(tool);
    setPdfFiles([]);
    setMessage("");
    setPassword("");
  };

  // PDF結合
  const mergePdfs = async () => {
    if (pdfFiles.length < 2) {
      setMessage("2つ以上のPDFファイルを選択してください");
      return;
    }
    setIsProcessing(true);
    setMessage("結合中...");
    try {
      const mergedPdf = await PDFDocument.create();
      for (const file of pdfFiles) {
        const pdfBytes = await readFile(file.path);
        const pdf = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }
      const mergedBytes = await mergedPdf.save();
      const savePath = await save({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
        defaultPath: "merged.pdf",
      });
      if (savePath) {
        await writeFile(savePath, mergedBytes);
        setMessage(`保存しました: ${savePath}`);
        setPdfFiles([]);
      } else {
        setMessage("保存がキャンセルされました");
      }
    } catch (error) {
      setMessage(`エラー: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // PDF分割
  const splitPdf = async () => {
    if (pdfFiles.length !== 1) {
      setMessage("1つのPDFファイルを選択してください");
      return;
    }
    setIsProcessing(true);
    setMessage("分割中...");
    try {
      const pdfBytes = await readFile(pdfFiles[0].path);
      const pdf = await PDFDocument.load(pdfBytes);
      const pageCount = pdf.getPageCount();

      const savePath = await save({
        filters: [{ name: "Folder", extensions: [] }],
        defaultPath: "split_pages",
      });

      if (savePath) {
        const baseDir = savePath.replace(/\.[^/.]+$/, "");
        try {
          await mkdir(baseDir, { recursive: true });
        } catch {
          // Directory might already exist
        }

        for (let i = 0; i < pageCount; i++) {
          const newPdf = await PDFDocument.create();
          const [copiedPage] = await newPdf.copyPages(pdf, [i]);
          newPdf.addPage(copiedPage);
          const newPdfBytes = await newPdf.save();
          const fileName = `${baseDir}/page_${String(i + 1).padStart(3, "0")}.pdf`;
          await writeFile(fileName, newPdfBytes);
        }
        setMessage(`${pageCount}ページを分割しました: ${baseDir}`);
        setPdfFiles([]);
      } else {
        setMessage("保存がキャンセルされました");
      }
    } catch (error) {
      setMessage(`エラー: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // PDF to JPEG
  const pdfToJpeg = async () => {
    if (pdfFiles.length !== 1) {
      setMessage("1つのPDFファイルを選択してください");
      return;
    }
    setIsProcessing(true);
    setMessage("変換中...");
    try {
      const pdfBytes = await readFile(pdfFiles[0].path);
      const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      const pageCount = pdf.numPages;

      const savePath = await save({
        filters: [{ name: "Folder", extensions: [] }],
        defaultPath: "pdf_images",
      });

      if (savePath) {
        const baseDir = savePath.replace(/\.[^/.]+$/, "");
        try {
          await mkdir(baseDir, { recursive: true });
        } catch {
          // Directory might already exist
        }

        for (let i = 1; i <= pageCount; i++) {
          const page = await pdf.getPage(i);
          const scale = 2.0;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d")!;
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          await page.render({ canvasContext: context, viewport, canvas }).promise;

          const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
          const base64Data = dataUrl.split(",")[1];
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let j = 0; j < binaryString.length; j++) {
            bytes[j] = binaryString.charCodeAt(j);
          }

          const fileName = `${baseDir}/page_${String(i).padStart(3, "0")}.jpg`;
          await writeFile(fileName, bytes);
        }
        setMessage(`${pageCount}ページをJPEGに変換しました: ${baseDir}`);
        setPdfFiles([]);
      } else {
        setMessage("保存がキャンセルされました");
      }
    } catch (error) {
      setMessage(`エラー: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // JPEG to PDF
  const jpegToPdf = async () => {
    if (pdfFiles.length === 0) {
      setMessage("画像ファイルを選択してください");
      return;
    }
    setIsProcessing(true);
    setMessage("変換中...");
    try {
      const pdf = await PDFDocument.create();

      for (const file of pdfFiles) {
        const imageBytes = await readFile(file.path);
        const lowerName = file.name.toLowerCase();

        let image;
        if (lowerName.endsWith(".png")) {
          image = await pdf.embedPng(imageBytes);
        } else {
          image = await pdf.embedJpg(imageBytes);
        }

        const page = pdf.addPage([image.width, image.height]);
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: image.width,
          height: image.height,
        });
      }

      const pdfBytes = await pdf.save();
      const savePath = await save({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
        defaultPath: "images.pdf",
      });

      if (savePath) {
        await writeFile(savePath, pdfBytes);
        setMessage(`保存しました: ${savePath}`);
        setPdfFiles([]);
      } else {
        setMessage("保存がキャンセルされました");
      }
    } catch (error) {
      setMessage(`エラー: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // PDFパスワード解除
  const unlockPdf = async () => {
    if (pdfFiles.length !== 1) {
      setMessage("1つのPDFファイルを選択してください");
      return;
    }
    if (!password) {
      setMessage("パスワードを入力してください");
      return;
    }
    setIsProcessing(true);
    setMessage("解除中...");
    try {
      const pdfBytes = await readFile(pdfFiles[0].path);

      // pdfjs-distを使ってパスワード付きPDFを読み込む（より多くの暗号化方式をサポート）
      const loadingTask = pdfjsLib.getDocument({ data: pdfBytes, password });
      const pdfDoc = await loadingTask.promise;
      const pageCount = pdfDoc.numPages;

      // 各ページを画像としてレンダリングし、新しいPDFを作成
      const unlockedPdf = await PDFDocument.create();

      for (let i = 1; i <= pageCount; i++) {
        const page = await pdfDoc.getPage(i);
        const scale = 2.0;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d")!;
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport, canvas }).promise;

        const dataUrl = canvas.toDataURL("image/png");
        const base64Data = dataUrl.split(",")[1];
        const binaryString = atob(base64Data);
        const imageBytes = new Uint8Array(binaryString.length);
        for (let j = 0; j < binaryString.length; j++) {
          imageBytes[j] = binaryString.charCodeAt(j);
        }

        const image = await unlockedPdf.embedPng(imageBytes);
        const pdfPage = unlockedPdf.addPage([viewport.width / scale, viewport.height / scale]);
        pdfPage.drawImage(image, {
          x: 0,
          y: 0,
          width: viewport.width / scale,
          height: viewport.height / scale,
        });
      }

      const unlockedBytes = await unlockedPdf.save();
      const savePath = await save({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
        defaultPath: "unlocked.pdf",
      });

      if (savePath) {
        await writeFile(savePath, unlockedBytes);
        setMessage(`パスワードを解除しました: ${savePath}`);
        setPdfFiles([]);
        setPassword("");
      } else {
        setMessage("保存がキャンセルされました");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("Incorrect Password") || errorMessage.includes("password")) {
        setMessage("エラー: パスワードが正しくありません");
      } else {
        setMessage(`エラー: ${errorMessage}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const renderFileList = (showOrder = true) => (
    <div className="file-list">
      {pdfFiles.length === 0 ? (
        <p className="empty">ファイルを追加してください</p>
      ) : (
        pdfFiles.map((file, index) => (
          <div key={`${file.path}-${index}`} className="file-item">
            {showOrder && <span className="file-number">{index + 1}</span>}
            <span className="file-name" title={file.path}>
              {file.name}
            </span>
            <div className="file-actions">
              {showOrder && (
                <>
                  <button
                    onClick={() => moveFile(index, "up")}
                    disabled={index === 0 || isProcessing}
                    title="上に移動"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveFile(index, "down")}
                    disabled={index === pdfFiles.length - 1 || isProcessing}
                    title="下に移動"
                  >
                    ↓
                  </button>
                </>
              )}
              <button
                onClick={() => removeFile(index)}
                disabled={isProcessing}
                className="remove"
                title="削除"
              >
                ×
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );

  const renderMergeTool = () => (
    <>
      <div className="tool-header">
        <h2>PDF結合</h2>
        <p className="tool-description">複数のPDFファイルを1つに結合します</p>
      </div>
      <div className="actions">
        <button onClick={() => addFiles()} disabled={isProcessing}>PDFを追加</button>
        <button onClick={mergePdfs} disabled={isProcessing || pdfFiles.length < 2} className="primary">
          結合して保存
        </button>
        <button onClick={clearAll} disabled={isProcessing || pdfFiles.length === 0}>クリア</button>
      </div>
      {message && <div className="message">{message}</div>}
      {renderFileList(true)}
      <p className="hint">
        {pdfFiles.length > 0 ? `${pdfFiles.length}個のファイル` : "複数のPDFを選択して結合"}
      </p>
    </>
  );

  const renderSplitTool = () => (
    <>
      <div className="tool-header">
        <h2>PDF分割</h2>
        <p className="tool-description">PDFを1ページずつ分割します</p>
      </div>
      <div className="actions">
        <button onClick={() => addSingleFile()} disabled={isProcessing}>PDFを選択</button>
        <button onClick={splitPdf} disabled={isProcessing || pdfFiles.length !== 1} className="primary">
          分割して保存
        </button>
        <button onClick={clearAll} disabled={isProcessing || pdfFiles.length === 0}>クリア</button>
      </div>
      {message && <div className="message">{message}</div>}
      {renderFileList(false)}
    </>
  );

  const renderPdfToJpegTool = () => (
    <>
      <div className="tool-header">
        <h2>PDF → JPEG</h2>
        <p className="tool-description">PDFの各ページをJPEG画像に変換します</p>
      </div>
      <div className="actions">
        <button onClick={() => addSingleFile()} disabled={isProcessing}>PDFを選択</button>
        <button onClick={pdfToJpeg} disabled={isProcessing || pdfFiles.length !== 1} className="primary">
          JPEGに変換
        </button>
        <button onClick={clearAll} disabled={isProcessing || pdfFiles.length === 0}>クリア</button>
      </div>
      {message && <div className="message">{message}</div>}
      {renderFileList(false)}
    </>
  );

  const renderJpegToPdfTool = () => (
    <>
      <div className="tool-header">
        <h2>JPEG → PDF</h2>
        <p className="tool-description">複数の画像を1つのPDFに変換します</p>
      </div>
      <div className="actions">
        <button onClick={() => addFiles(["jpg", "jpeg", "png"], "Images")} disabled={isProcessing}>
          画像を追加
        </button>
        <button onClick={jpegToPdf} disabled={isProcessing || pdfFiles.length === 0} className="primary">
          PDFに変換
        </button>
        <button onClick={clearAll} disabled={isProcessing || pdfFiles.length === 0}>クリア</button>
      </div>
      {message && <div className="message">{message}</div>}
      {renderFileList(true)}
      <p className="hint">
        {pdfFiles.length > 0 ? `${pdfFiles.length}個の画像` : "JPEGまたはPNG画像を選択"}
      </p>
    </>
  );

  const renderUnlockTool = () => (
    <>
      <div className="tool-header">
        <h2>パスワード解除</h2>
        <p className="tool-description">パスワード保護されたPDFを解除します</p>
      </div>
      <div className="actions">
        <button onClick={() => addSingleFile()} disabled={isProcessing}>PDFを選択</button>
        <button onClick={unlockPdf} disabled={isProcessing || pdfFiles.length !== 1 || !password} className="primary">
          解除して保存
        </button>
        <button onClick={clearAll} disabled={isProcessing || pdfFiles.length === 0}>クリア</button>
      </div>
      {pdfFiles.length === 1 && (
        <div className="password-input">
          <input
            type="password"
            placeholder="PDFのパスワードを入力"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isProcessing}
          />
        </div>
      )}
      {message && <div className="message">{message}</div>}
      {renderFileList(false)}
    </>
  );

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>PDF Tools</h1>
        </div>
        <nav className="sidebar-nav">
          {tools.map((tool) => (
            <button
              key={tool.id}
              className={`nav-item ${currentTool === tool.id ? "active" : ""}`}
              onClick={() => handleToolChange(tool.id)}
            >
              <span className="nav-icon">{tool.icon}</span>
              <span className="nav-label">{tool.name}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        {currentTool === "merge" && renderMergeTool()}
        {currentTool === "split" && renderSplitTool()}
        {currentTool === "pdfToJpeg" && renderPdfToJpegTool()}
        {currentTool === "jpegToPdf" && renderJpegToPdfTool()}
        {currentTool === "unlock" && renderUnlockTool()}
      </main>
    </div>
  );
}

export default App;
