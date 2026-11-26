import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Car,
  Bike,
  PersonStanding,
  Upload,
  Play,
  Square,
  Clock,
  Camera,
  Video,
  Image as ImageIcon,
  RotateCcw,
  Server,
  Cpu,
  Wifi,
  WifiOff,
} from "lucide-react";
import { VEHICLE_CLASSES } from "./config/classes";
import {
  checkYoloApiStatus,
  sendFrameToYoloApi,
  sendImageToYoloApi,
  resetYoloSession,
} from "./services/yoloApi";

const TARGET_FPS = 24;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS; // 24 FPS (~41.67 ms)

export default function App() {
  // Mode: "api" (Model YOLOv11s + BoT-SORT) | "standalone" (Simulasi Tanpa Server)
  const [systemMode, setSystemMode] = useState("api");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiStatus, setApiStatus] = useState("disconnected"); // "disconnected" | "checking" | "connected"
  const [modelClassesMap, setModelClassesMap] = useState({});
  const [actualFps, setActualFps] = useState(0);

  const [inputMode, setInputMode] = useState("video"); // "video" | "camera" | "image"
  const [mediaSrc, setMediaSrc] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [lineYPercent, setLineYPercent] = useState(66);

  const [counts, setCounts] = useState(() =>
    Object.fromEntries(VEHICLE_CLASSES.map((c) => [c.id, 0]))
  );
  const [logs, setLogs] = useState([]);
  const [activeDetections, setActiveDetections] = useState([]);

  const videoRef = useRef(null);
  const imageRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const sessionIdRef = useRef(`session_${Date.now()}`);
  const simObjectsRef = useRef([]);
  const countedIdsRef = useRef(new Set());
  const isProcessingFrameRef = useRef(false);

  const getCurrentTimeStr = () => new Date().toTimeString().slice(0, 5);

  const handleConnectApi = async () => {
    if (!apiBaseUrl.trim()) {
      alert("Masukkan URL server dari Google Colab terlebih dahulu.");
      return;
    }
    setApiStatus("checking");
    const info = await checkYoloApiStatus(apiBaseUrl.trim());
    if (info && info.status === "online") {
      setApiStatus("connected");
      setModelClassesMap(info.classes || {});
    } else {
      setApiStatus("disconnected");
      alert("Gagal terhubung ke server. Pastikan Cell 5 Colab aktif dan URL benar.");
    }
  };

  const getClassDisplay = useCallback(
    (clsId, fallbackName) => {
      const base = VEHICLE_CLASSES.find((c) => c.id === clsId) || VEHICLE_CLASSES[0];
      const rawModelName = modelClassesMap[clsId] || fallbackName || base.label;
      return {
        ...base,
        displayLabel:
          rawModelName.charAt(0).toUpperCase() + rawModelName.slice(1).replace(/_/g, " "),
      };
    },
    [modelClassesMap]
  );

  const registerCrossedEvents = useCallback(
    (crossedItems) => {
      if (!crossedItems || crossedItems.length === 0) return;

      setCounts((prev) => {
        const updated = { ...prev };
        crossedItems.forEach((item) => {
          const id = item.class_id ?? 0;
          if (updated[id] !== undefined) updated[id] += 1;
        });
        return updated;
      });

      const timeStr = getCurrentTimeStr();
      setLogs((prev) => [
        ...crossedItems.map((item, idx) => {
          const info = getClassDisplay(item.class_id ?? 0, item.class_name);
          return {
            id: `${Date.now()}_${idx}_${Math.random()}`,
            time: timeStr,
            label: info.displayLabel.toLowerCase(),
          };
        }),
        ...prev.slice(0, 49),
      ]);
    },
    [getClassDisplay]
  );

  const handleReset = async () => {
    setIsRunning(false);
    setActualFps(0);
    setCounts(Object.fromEntries(VEHICLE_CLASSES.map((c) => [c.id, 0])));
    setLogs([]);
    setActiveDetections([]);
    simObjectsRef.current = [];
    countedIdsRef.current.clear();

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    if (systemMode === "api" && apiStatus === "connected") {
      await resetYoloSession(apiBaseUrl, sessionIdRef.current);
    }
    sessionIdRef.current = `session_${Date.now()}`;
  };

  const startLiveCamera = async () => {
    await handleReset();
    setInputMode("camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      alert("Gagal mengakses kamera. Pastikan izin kamera diaktifkan di browser.");
    }
  };

  const stopCameraStream = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    stopCameraStream();
    await handleReset();

    const url = URL.createObjectURL(file);
    setMediaSrc(url);
    setInputMode(file.type.startsWith("image/") ? "image" : "video");
  };

  const runSimulationStep = (width, height) => {
    const lineY = (lineYPercent / 100) * height;
    if (Math.random() < 0.08 && simObjectsRef.current.length < 6) {
      const cls = VEHICLE_CLASSES[Math.floor(Math.random() * VEHICLE_CLASSES.length)];
      const boxW = cls.id === 2 ? 42 : cls.id === 1 ? 54 : 110;
      const boxH = cls.id === 2 ? 95 : cls.id === 1 ? 85 : 80;
      simObjectsRef.current.push({
        track_id: Math.floor(100 + Math.random() * 900),
        class_id: cls.id,
        class_name: cls.key,
        x: Math.random() * (width - boxW - 40) + 20,
        y: height * 0.25,
        w: boxW,
        h: boxH,
        vy: 2.2 + Math.random() * 2.5,
      });
    }

    const newlyCrossed = [];
    const nextObjects = [];

    for (const obj of simObjectsRef.current) {
      const prevBottom = obj.y + obj.h;
      obj.y += obj.vy;
      obj.w *= 1.004;
      obj.h *= 1.004;
      const currBottom = obj.y + obj.h;

      if (prevBottom < lineY && currBottom >= lineY && !countedIdsRef.current.has(obj.track_id)) {
        countedIdsRef.current.add(obj.track_id);
        newlyCrossed.push({ class_id: obj.class_id, class_name: obj.class_name });
      }
      if (obj.y < height) nextObjects.push(obj);
    }

    simObjectsRef.current = nextObjects;
    if (newlyCrossed.length > 0) registerCrossedEvents(newlyCrossed);
    return nextObjects;
  };

  const drawOverlay = useCallback(
    (detections) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const { width, height } = canvas;

      ctx.clearRect(0, 0, width, height);

      // Garis Hitung Putih
      const lineY = (lineYPercent / 100) * height;
      ctx.save();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(255, 255, 255, 0.5)";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(width * 0.06, lineY);
      ctx.lineTo(width * 0.94, lineY);
      ctx.stroke();

      ctx.fillStyle = "#e2e8f0";
      ctx.font = "500 14px Inter, system-ui, sans-serif";
      ctx.fillText("garis hitung", width * 0.24, lineY + 20);
      ctx.restore();

      // Bounding Box + Track ID BoT-SORT
      detections.forEach((det) => {
        const clsInfo = getClassDisplay(det.class_id ?? 0, det.class_name);
        ctx.strokeStyle = clsInfo.color;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(det.x, det.y, det.w, det.h);

        const labelText = det.track_id
          ? `${clsInfo.displayLabel.toLowerCase()} #${det.track_id}`
          : clsInfo.displayLabel.toLowerCase();

        ctx.font = "600 12px Inter, system-ui, sans-serif";
        const badgeW = ctx.measureText(labelText).width + 12;
        const badgeH = 22;

        ctx.fillStyle = clsInfo.color;
        ctx.fillRect(det.x, Math.max(0, det.y - badgeH), badgeW, badgeH);

        ctx.fillStyle = "#ffffff";
        ctx.fillText(labelText, det.x + 6, Math.max(15, det.y - 6));
      });
    },
    [lineYPercent, getClassDisplay]
  );

  // Loop 24 FPS untuk Video & Live Camera
  useEffect(() => {
    if (!isRunning || inputMode === "image") {
      drawOverlay(activeDetections);
      return;
    }

    if (videoRef.current && videoRef.current.paused && inputMode === "video") {
      videoRef.current.play().catch(() => {});
    }

    const interval = setInterval(async () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas) return;

      if (systemMode === "standalone") {
        const dets = runSimulationStep(canvas.width, canvas.height);
        setActiveDetections(dets);
        drawOverlay(dets);
        setActualFps(24);
      } else if (systemMode === "api") {
        if (apiStatus !== "connected") return;
        if (isProcessingFrameRef.current) return;

        isProcessingFrameRef.current = true;
        const t0 = performance.now();
        try {
          const offscreen = document.createElement("canvas");
          offscreen.width = canvas.width;
          offscreen.height = canvas.height;
          const offCtx = offscreen.getContext("2d");
          if (video && video.readyState >= 2) {
            offCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
          const blob = await new Promise((res) => offscreen.toBlob(res, "image/jpeg", 0.8));
          if (blob) {
            const result = await sendFrameToYoloApi({
              apiBaseUrl,
              blob,
              sessionId: sessionIdRef.current,
              lineYRatio: lineYPercent / 100,
            });
            if (result) {
              setActiveDetections(result.detections || []);
              drawOverlay(result.detections || []);
              if (result.newly_crossed?.length > 0) {
                registerCrossedEvents(result.newly_crossed);
              }
              const elapsed = performance.now() - t0;
              setActualFps(Math.min(24, Math.max(1, Math.round(1000 / elapsed))));
            }
          }
        } finally {
          isProcessingFrameRef.current = false;
        }
      }
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [
    isRunning,
    inputMode,
    systemMode,
    apiStatus,
    apiBaseUrl,
    lineYPercent,
    drawOverlay,
    registerCrossedEvents,
  ]);

  const handleRunSingleImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (systemMode === "standalone") {
      const mockDets = [
        { track_id: 1, class_id: 0, class_name: "mobil", x: canvas.width * 0.26, y: canvas.height * 0.42, w: 95, h: 75 },
        { track_id: 2, class_id: 1, class_name: "motor", x: canvas.width * 0.42, y: canvas.height * 0.40, w: 55, h: 85 },
        { track_id: 3, class_id: 2, class_name: "manusia", x: canvas.width * 0.56, y: canvas.height * 0.36, w: 48, h: 105 },
      ];
      setActiveDetections(mockDets);
      drawOverlay(mockDets);
      registerCrossedEvents(mockDets);
    } else {
      if (apiStatus !== "connected") {
        alert("Hubungkan URL Server YOLOv11s terlebih dahulu di bar atas.");
        return;
      }
      const img = imageRef.current;
      if (!img) return;
      const offscreen = document.createElement("canvas");
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      offscreen.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((res) => offscreen.toBlob(res, "image/jpeg", 0.9));
      const result = await sendImageToYoloApi({
        apiBaseUrl,
        blob,
        lineYRatio: lineYPercent / 100,
      });
      if (result) {
        setActiveDetections(result.detections || []);
        drawOverlay(result.detections || []);
        registerCrossedEvents(result.newly_crossed || []);
      }
    }
  };

  const featuredClasses = VEHICLE_CLASSES.filter((c) => c.featured);
  const extraClasses = VEHICLE_CLASSES.filter((c) => !c.featured);

  const renderFeaturedIcon = (idx) => {
    if (idx === 0) return <Car className="w-8 h-8 text-blue-400" />;
    if (idx === 1) return <Bike className="w-8 h-8 text-orange-400" />;
    return <PersonStanding className="w-8 h-8 text-emerald-400" />;
  };

  return (
    <div className="min-h-screen bg-[#0c1013] text-slate-100 font-sans flex flex-col">
      {/* HEADER */}
      <header className="border-b border-[#1f272f] bg-[#10151a] px-4 md:px-8 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">Urban Night</h1>
          <span className="hidden sm:inline-flex items-center text-xs px-2.5 py-1 rounded-md bg-[#182028] text-slate-300 border border-[#26313d]">
            YOLOv11s • BoT-SORT • 24 FPS
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Toggle Mode */}
          <button
            onClick={() => {
              setIsRunning(false);
              setSystemMode((m) => (m === "api" ? "standalone" : "api"));
            }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-[#171e26] hover:bg-[#1f2833] border border-[#2a3542] text-slate-200 transition"
          >
            {systemMode === "api" ? (
              <>
                <Server className="w-3.5 h-3.5 text-sky-400" />
                <span>Mode: AI Model</span>
              </>
            ) : (
              <>
                <Cpu className="w-3.5 h-3.5 text-amber-400" />
                <span>Mode: Simulasi FE</span>
              </>
            )}
          </button>

          {/* Status Sesi */}
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#12281d] border border-[#1d4430]">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isRunning ? "bg-emerald-400 animate-pulse" : "bg-emerald-500"
              }`}
            />
            <span className="text-xs md:text-sm font-medium text-emerald-400">
              {isRunning ? `Sesi aktif (${actualFps} FPS)` : "Sesi aktif"}
            </span>
          </div>
        </div>
      </header>

      {/* PANEL KONEKSI REST API YOLOv11s */}
      {systemMode === "api" && (
        <div className="bg-[#131a21] border-b border-[#222d38] px-4 md:px-8 py-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 text-xs md:text-sm">
          <div className="flex items-center gap-2 whitespace-nowrap">
            {apiStatus === "connected" ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                <Wifi className="w-4 h-4" /> Server Terhubung
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">
                <WifiOff className="w-4 h-4" /> Belum Terhubung
              </span>
            )}
          </div>

          <input
            type="text"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            placeholder="Tempel link https://... dari Colab di sini..."
            className="flex-1 bg-[#0b0f13] border border-[#2a3642] rounded-lg px-3 py-1.5 text-slate-100 focus:outline-none focus:border-emerald-500"
          />

          <button
            onClick={handleConnectApi}
            disabled={apiStatus === "checking"}
            className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium transition whitespace-nowrap"
          >
            {apiStatus === "checking" ? "Menghubungkan..." : "Hubungkan Model"}
          </button>
        </div>
      )}

      {/* MAIN CONTENT */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* KIRI: KANVAS DETEKSI */}
        <section className="lg:col-span-8 flex flex-col gap-4 bg-[#12171d] border border-[#1f2730] rounded-2xl p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-xl bg-[#0d1115] p-1 border border-[#1f2832]">
              <button
                onClick={startLiveCamera}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition ${
                  inputMode === "camera" ? "bg-[#1e2732] text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Camera className="w-4 h-4" />
                Live Camera
              </button>
              <button
                onClick={() => {
                  stopCameraStream();
                  setInputMode("video");
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition ${
                  inputMode === "video" ? "bg-[#1e2732] text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Video className="w-4 h-4" />
                Video
              </button>
              <button
                onClick={() => {
                  stopCameraStream();
                  setInputMode("image");
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition ${
                  inputMode === "image" ? "bg-[#1e2732] text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <ImageIcon className="w-4 h-4" />
                Foto
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Garis Putih:</span>
              <input
                type="range"
                min="25"
                max="85"
                value={lineYPercent}
                onChange={(e) => setLineYPercent(Number(e.target.value))}
                className="w-24 accent-white cursor-pointer"
              />
              <span className="w-8 text-slate-200">{lineYPercent}%</span>
            </div>
          </div>

          <div className="relative w-full aspect-video bg-[#080b0e] rounded-xl overflow-hidden border border-[#222b35] flex items-center justify-center">
            {inputMode === "image" && mediaSrc ? (
              <img
                ref={imageRef}
                src={mediaSrc}
                alt="Preview"
                onLoad={() => drawOverlay(activeDetections)}
                className="w-full h-full object-cover"
              />
            ) : (
              <video
                ref={videoRef}
                src={inputMode === "video" ? mediaSrc : undefined}
                loop
                muted
                playsInline
                onLoadedData={() => drawOverlay(activeDetections)}
                className="w-full h-full object-cover"
              />
            )}

            {!mediaSrc && inputMode !== "camera" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-gradient-to-b from-[#0f141a] to-[#090c10]">
                <p className="text-slate-300 font-medium text-sm md:text-base">
                  {systemMode === "api"
                    ? "Deteksi YOLOv11s + BoT-SORT Malam Hari (10 Class)"
                    : "Mode Simulasi FE (Tanpa Server Model)"}
                </p>
                <p className="text-slate-500 text-xs mt-1 max-w-md">
                  {systemMode === "api"
                    ? "Tempel link server Colab di atas → klik Hubungkan Model → unggah video/foto atau nyalakan Live Camera."
                    : "Unggah video/foto atau klik Mulai hitung untuk simulasi."}
                </p>
              </div>
            )}

            <canvas
              ref={canvasRef}
              width={960}
              height={540}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,image/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#192028] hover:bg-[#222b36] border border-[#2c3744] text-slate-100 text-sm font-medium transition"
              >
                <Upload className="w-4 h-4 text-slate-300" />
                <span>Unggah video</span>
              </button>

              <button
                onClick={handleReset}
                className="p-2.5 rounded-xl bg-[#192028] hover:bg-[#222b36] border border-[#2c3744] text-slate-300 transition"
                title="Reset Hitungan"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>

            {inputMode === "image" ? (
              <button
                onClick={handleRunSingleImage}
                className="flex items-center gap-2.5 px-6 py-2.5 rounded-xl bg-[#1b7a43] hover:bg-[#166534] text-white text-sm font-semibold transition"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Deteksi Foto</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  if (systemMode === "api" && apiStatus !== "connected") {
                    alert("Hubungkan URL Server YOLOv11s terlebih dahulu di bar atas.");
                    return;
                  }
                  setIsRunning((prev) => !prev);
                }}
                className={`flex items-center gap-2.5 px-6 py-2.5 rounded-xl text-white text-sm font-semibold transition ${
                  isRunning ? "bg-rose-600 hover:bg-rose-700" : "bg-[#1b7a43] hover:bg-[#166534]"
                }`}
              >
                {isRunning ? (
                  <>
                    <Square className="w-4 h-4 fill-current" />
                    <span>Hentikan</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Mulai hitung</span>
                  </>
                )}
              </button>
            )}
          </div>
        </section>

        {/* KANAN: YANG LEWAT (10 CLASS) & CATATAN */}
        <aside className="lg:col-span-4 bg-[#12171d] border border-[#1f2730] rounded-2xl p-4 md:p-5 flex flex-col gap-5">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base md:text-lg font-semibold text-white">Yang lewat</h2>
              <span className="text-xs text-slate-400">
                Total:{" "}
                <strong className="text-white">
                  {Object.values(counts).reduce((a, b) => a + b, 0)}
                </strong>
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {featuredClasses.map((cls, idx) => {
                const info = getClassDisplay(cls.id, cls.label);
                return (
                  <div
                    key={cls.id}
                    className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border ${cls.bg} ${cls.border}`}
                  >
                    <div className="w-12 h-12 rounded-xl bg-black/25 flex items-center justify-center shrink-0">
                      {renderFeaturedIcon(idx)}
                    </div>
                    <div>
                      <div className={`text-sm font-medium ${cls.text}`}>{info.displayLabel}</div>
                      <div className="text-2xl md:text-3xl font-bold text-white leading-tight">
                        {counts[cls.id]}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {extraClasses.map((cls) => {
                const info = getClassDisplay(cls.id, cls.label);
                return (
                  <div
                    key={cls.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#161d24] border border-[#232d37]"
                  >
                    <span className="text-xs text-slate-300 truncate pr-2">
                      {info.displayLabel}
                    </span>
                    <span className="text-sm font-bold text-white">{counts[cls.id]}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-[180px] border-t border-[#1f2730] pt-4">
            <h2 className="text-base font-semibold text-white mb-3">Catatan</h2>
            <div className="flex-1 max-h-56 overflow-y-auto pr-1 flex flex-col gap-2.5">
              {logs.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Belum ada objek yang melintasi garis hitung putih.
                </p>
              ) : (
                logs.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 text-sm text-slate-300 py-1 border-b border-[#1a2129] last:border-none"
                  >
                    <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-mono text-slate-400">{item.time}</span>
                    <span className="font-medium text-slate-100">{item.label}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}