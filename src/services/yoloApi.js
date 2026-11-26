const COMMON_HEADERS = {
  "ngrok-skip-browser-warning": "true",
};

export async function checkYoloApiStatus(apiBaseUrl) {
  try {
    const cleanUrl = apiBaseUrl.replace(/\/+$/, "");
    const res = await fetch(`${cleanUrl}/api/status`, {
      method: "GET",
      headers: COMMON_HEADERS,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function sendFrameToYoloApi({ apiBaseUrl, blob, sessionId, lineYRatio }) {
  try {
    const cleanUrl = apiBaseUrl.replace(/\/+$/, "");
    const formData = new FormData();
    formData.append("file", blob, "frame.jpg");
    formData.append("session_id", sessionId);
    formData.append("line_y_ratio", String(lineYRatio));

    const res = await fetch(`${cleanUrl}/api/predict/frame`, {
      method: "POST",
      headers: COMMON_HEADERS,
      body: formData,
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function sendImageToYoloApi({ apiBaseUrl, blob, lineYRatio }) {
  try {
    const cleanUrl = apiBaseUrl.replace(/\/+$/, "");
    const formData = new FormData();
    formData.append("file", blob, "image.jpg");
    formData.append("line_y_ratio", String(lineYRatio));

    const res = await fetch(`${cleanUrl}/api/predict/image`, {
      method: "POST",
      headers: COMMON_HEADERS,
      body: formData,
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function resetYoloSession(apiBaseUrl, sessionId) {
  try {
    const cleanUrl = apiBaseUrl.replace(/\/+$/, "");
    await fetch(`${cleanUrl}/api/reset/${sessionId}`, {
      method: "POST",
      headers: COMMON_HEADERS,
    });
  } catch {}
}