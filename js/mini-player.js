const CHANNEL_NAME = "solara-mini-player";
const STATE_KEY = "solara.miniPlayerState";

const dom = {
    cover: document.getElementById("miniCover"),
    title: document.getElementById("miniTitle"),
    artist: document.getElementById("miniArtist"),
    playBtn: document.getElementById("miniPlayBtn"),
    prevBtn: document.getElementById("miniPrevBtn"),
    nextBtn: document.getElementById("miniNextBtn"),
    closeBtn: document.getElementById("miniCloseBtn"),
    progress: document.getElementById("miniProgressBar"),
    currentTime: document.getElementById("miniCurrentTime"),
    duration: document.getElementById("miniDuration"),
};

const channel = typeof BroadcastChannel === "function"
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "00:00";
    }
    const total = Math.floor(seconds);
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function postCommand(action, value) {
    if (!channel) {
        return;
    }
    channel.postMessage({ type: "command", action, value });
}

function renderState(state) {
    if (!state || typeof state !== "object") {
        return;
    }

    dom.title.textContent = state.title || "选择一首歌曲";
    dom.artist.textContent = state.artist || "未知艺术家";

    if (state.artworkUrl) {
        dom.cover.textContent = "";
        const image = document.createElement("img");
        image.src = state.artworkUrl;
        image.alt = "";
        dom.cover.appendChild(image);
    } else {
        dom.cover.innerHTML = '<i class="fas fa-music" aria-hidden="true"></i>';
    }

    const duration = Number(state.duration) || 0;
    const currentTime = Number(state.currentTime) || 0;
    dom.progress.max = String(duration);
    dom.progress.value = String(Math.min(currentTime, duration || currentTime));
    dom.currentTime.textContent = formatTime(currentTime);
    dom.duration.textContent = formatTime(duration);

    const icon = state.isPlaying ? "fa-pause" : "fa-play";
    dom.playBtn.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;
    dom.playBtn.setAttribute("aria-label", state.isPlaying ? "暂停" : "播放");
}

function loadStoredState() {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        if (raw) {
            renderState(JSON.parse(raw));
        }
    } catch (error) {
        console.warn("读取迷你播放器状态失败", error);
    }
}

dom.playBtn.addEventListener("click", () => postCommand("toggle"));
dom.prevBtn.addEventListener("click", () => postCommand("previous"));
dom.nextBtn.addEventListener("click", () => postCommand("next"));
dom.closeBtn.addEventListener("click", () => window.close());
dom.progress.addEventListener("input", () => {
    dom.currentTime.textContent = formatTime(Number(dom.progress.value));
});
dom.progress.addEventListener("change", () => {
    postCommand("seek", Number(dom.progress.value));
});

if (channel) {
    channel.addEventListener("message", (event) => {
        if (event.data && event.data.type === "state") {
            renderState(event.data.state);
        }
    });
}

window.addEventListener("storage", (event) => {
    if (event.key === STATE_KEY && event.newValue) {
        try {
            renderState(JSON.parse(event.newValue));
        } catch (error) {
            console.warn("同步迷你播放器状态失败", error);
        }
    }
});

loadStoredState();
postCommand("requestState");
