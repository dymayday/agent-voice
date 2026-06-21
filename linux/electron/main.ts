import { app, BrowserWindow } from "electron";
import { resolve } from "node:path";

function createWindow(): void {
	const window = new BrowserWindow({
		width: 1200,
		height: 800,
	});

	const rendererUrl = process.env.AGENT_VOICE_RENDERER_URL;

	if (rendererUrl) {
		void window.loadURL(rendererUrl);
		return;
	}

	void window.loadFile(resolve("dist/linux-renderer/index.html"));
}

app.whenReady().then(() => {
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
