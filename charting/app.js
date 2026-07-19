/*
 * app.js — 피부과 보이스 차팅 위젯 로직
 * 흐름:  녹음 → STT(음성→텍스트) → (비식별화) → LLM 차팅(SOAP/상담) → 편집 → 원클릭 복사
 * 의존:  config.js (DERM_TERMS, SYSTEM_PROMPTS, DEFAULT_SETTINGS)
 */
(function () {
  "use strict";

  const LS_KEY = "lumiChartingSettings";
  const $ = (id) => document.getElementById(id);

  // ---- 상태 ----
  let settings = loadSettings();
  let mediaRecorder = null;
  let chunks = [];
  let stream = null;
  let recording = false;
  let timerId = null;
  let startedAt = 0;

  // ---- 설정 로드/저장 ----
  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch (_) {}
    const base = Object.assign({}, window.DEFAULT_SETTINGS, saved);
    // 용어 사전: 저장값 없으면 스타터 사용
    if (!base.terms) base.terms = (window.DERM_TERMS || []).join(", ");
    return base;
  }
  function saveSettings() {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  }

  // ---- 유틸: 용어 배열, 힌트 문자열 ----
  function termArray() {
    return (settings.terms || "")
      .split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  }

  // ---- 비식별화: 전송 전 개인정보 마스킹 ----
  function deidentify(text) {
    if (!settings.deidentify || !text) return text;
    let t = text;
    // 주민등록번호 (6-7)
    t = t.replace(/\b\d{6}[-\s]?\d{7}\b/g, "[주민번호]");
    // 휴대폰 번호
    t = t.replace(/\b01[016-9][-\s]?\d{3,4}[-\s]?\d{4}\b/g, "[전화번호]");
    // 일반 전화(지역번호)
    t = t.replace(/\b0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}\b/g, "[전화번호]");
    // 환자명(설정된 경우만)
    const name = (settings.patientNameMask || "").trim();
    if (name) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      t = t.replace(new RegExp(esc, "g"), "[환자]");
    }
    return t;
  }

  // ---- 상태 표시 ----
  function setStatus(msg, kind) {
    const el = $("status");
    el.textContent = msg;
    el.className = "status" + (kind ? " " + kind : "");
  }

  // ---- 타이머 ----
  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }
  function startTimer() {
    startedAt = performance.now();
    $("timer").textContent = "00:00";
    timerId = setInterval(() => { $("timer").textContent = fmt(performance.now() - startedAt); }, 250);
  }
  function stopTimer() { clearInterval(timerId); timerId = null; }

  // ---- 녹음 ----
  async function startRecording() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setStatus("마이크 권한이 필요합니다: " + e.message, "err");
      return;
    }
    chunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = onRecordingStopped;
    mediaRecorder.start();
    recording = true;
    $("btnRec").classList.add("recording");
    $("btnRec").textContent = "■";
    startTimer();
    setStatus("녹음 중… 다시 누르면 정지합니다.", "busy");
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    recording = false;
    stopTimer();
    $("btnRec").classList.remove("recording");
    $("btnRec").textContent = "●";
  }

  async function onRecordingStopped() {
    // 마이크 트랙 정리
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    const blob = new Blob(chunks, { type: (chunks[0] && chunks[0].type) || "audio/webm" });
    if (settings.autoDeleteAudio) chunks = []; // 버퍼 폐기
    if (!blob.size) { setStatus("녹음된 음성이 없습니다.", "err"); return; }
    await transcribe(blob);
  }

  // ---- STT: 음성 → 텍스트 ----
  async function transcribe(blob) {
    if (!settings.sttKey) {
      setStatus("설정에서 STT API Key를 입력하세요.", "err");
      $("btnSettings").click();
      return;
    }
    $("btnRec").disabled = true;
    setStatus("음성을 텍스트로 변환 중…", "busy");
    try {
      const fd = new FormData();
      fd.append("file", blob, "audio.webm");
      fd.append("model", settings.sttModel || "whisper-1");
      if (settings.sttLanguage) fd.append("language", settings.sttLanguage);
      // 피부과 용어를 힌트로 주입 → 유사 발음 오인식 감소
      fd.append("prompt", termArray().join(", "));
      const res = await fetch(joinUrl(settings.sttBaseUrl, "/audio/transcriptions"), {
        method: "POST",
        headers: { Authorization: "Bearer " + settings.sttKey },
        body: fd
      });
      if (!res.ok) throw new Error("STT " + res.status + ": " + (await safeErr(res)));
      const data = await res.json();
      const text = (data.text || "").trim();
      $("transcript").value = text;
      $("secTranscript").classList.remove("hidden");
      setStatus(text ? "변환 완료. 확인 후 ‘차트 생성’을 누르세요." : "인식된 내용이 없습니다.", text ? "" : "err");
      if (text) await generateChart(); // 자동으로 이어서 차트 생성
    } catch (e) {
      setStatus(String(e.message || e), "err");
    } finally {
      $("btnRec").disabled = false;
    }
  }

  // ---- LLM: 텍스트 → SOAP/상담 차트 ----
  async function generateChart() {
    const raw = $("transcript").value.trim();
    if (!raw) { setStatus("먼저 음성 원문을 입력/수정하세요.", "err"); return; }
    if (!settings.llmKey) {
      setStatus("설정에서 LLM API Key를 입력하세요.", "err");
      $("btnSettings").click();
      return;
    }
    $("btnChart").disabled = true;
    setStatus("차트를 생성하는 중…", "busy");
    try {
      const sys = (window.SYSTEM_PROMPTS[settings.mode] || window.SYSTEM_PROMPTS.clinic)
        .replace("{TERMS}", termArray().join(", "));
      const userText = deidentify(raw);
      const res = await fetch(joinUrl(settings.llmBaseUrl, "/chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + settings.llmKey
        },
        body: JSON.stringify({
          model: settings.llmModel || "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: "다음 진료/상담 대화를 위 형식으로 정리하세요.\n\n---\n" + userText }
          ]
        })
      });
      if (!res.ok) throw new Error("LLM " + res.status + ": " + (await safeErr(res)));
      const data = await res.json();
      const out = ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "").trim();
      $("chart").value = out;
      $("secChart").classList.remove("hidden");
      setStatus("차트 생성 완료. 수정 후 복사해 EMR에 붙여넣으세요.", "");
    } catch (e) {
      setStatus(String(e.message || e), "err");
    } finally {
      $("btnChart").disabled = false;
    }
  }

  // ---- 헬퍼 ----
  function joinUrl(base, path) {
    return String(base || "").replace(/\/+$/, "") + path;
  }
  async function safeErr(res) {
    try {
      const j = await res.json();
      return (j.error && (j.error.message || j.error)) || JSON.stringify(j);
    } catch (_) { return res.statusText; }
  }
  async function copyToClipboard(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // 폴백
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    }
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = "복사됨"; btn.classList.add("ok");
      setTimeout(() => { btn.textContent = prev; btn.classList.remove("ok"); }, 1200);
    }
  }

  // ---- 모드 ----
  function applyMode() {
    document.querySelectorAll(".mode-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === settings.mode));
    $("chartTitle").textContent = settings.mode === "consult" ? "③ 상담 요약" : "③ SOAP 차트";
  }

  // ---- 설정창 바인딩 ----
  function openSettings() {
    $("sttBaseUrl").value = settings.sttBaseUrl || "";
    $("sttModel").value = settings.sttModel || "";
    $("sttKey").value = settings.sttKey || "";
    $("sttLanguage").value = settings.sttLanguage || "";
    $("llmBaseUrl").value = settings.llmBaseUrl || "";
    $("llmModel").value = settings.llmModel || "";
    $("llmKey").value = settings.llmKey || "";
    $("deidentify").checked = !!settings.deidentify;
    $("patientNameMask").value = settings.patientNameMask || "";
    $("autoDeleteAudio").checked = !!settings.autoDeleteAudio;
    $("termList").value = settings.terms || "";
    $("overlay").classList.remove("hidden");
  }
  function saveFromSettings() {
    settings.sttBaseUrl = $("sttBaseUrl").value.trim();
    settings.sttModel = $("sttModel").value.trim();
    settings.sttKey = $("sttKey").value.trim();
    settings.sttLanguage = $("sttLanguage").value.trim();
    settings.llmBaseUrl = $("llmBaseUrl").value.trim();
    settings.llmModel = $("llmModel").value.trim();
    settings.llmKey = $("llmKey").value.trim();
    settings.deidentify = $("deidentify").checked;
    settings.patientNameMask = $("patientNameMask").value.trim();
    settings.autoDeleteAudio = $("autoDeleteAudio").checked;
    settings.terms = $("termList").value.trim();
    saveSettings();
    $("overlay").classList.add("hidden");
    setStatus("설정을 저장했습니다.", "");
  }

  // ---- Electron 창 컨트롤(있을 때만) ----
  function wireElectron() {
    if (!window.widgetAPI) return;
    $("btnMin").classList.remove("hidden");
    $("btnClose").classList.remove("hidden");
    $("btnMin").addEventListener("click", () => window.widgetAPI.minimize());
    $("btnClose").addEventListener("click", () => window.widgetAPI.close());
  }

  // ---- 이벤트 바인딩 ----
  function init() {
    applyMode();
    wireElectron();

    $("btnRec").addEventListener("click", () => (recording ? stopRecording() : startRecording()));
    $("btnChart").addEventListener("click", generateChart);

    document.querySelectorAll(".mode-btn").forEach((b) =>
      b.addEventListener("click", () => { settings.mode = b.dataset.mode; saveSettings(); applyMode(); }));

    document.querySelectorAll(".copy-btn").forEach((b) =>
      b.addEventListener("click", () => copyToClipboard($(b.dataset.copy).value, b)));

    $("btnSettings").addEventListener("click", openSettings);
    $("btnCloseSettings").addEventListener("click", () => $("overlay").classList.add("hidden"));
    $("btnSaveSettings").addEventListener("click", saveFromSettings);
    $("overlay").addEventListener("click", (e) => { if (e.target.id === "overlay") $("overlay").classList.add("hidden"); });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
