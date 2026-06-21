import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import CapsuleApp from "./capsule/CapsuleApp.svelte";

const target = document.getElementById("app");

if (!target) {
	throw new Error("Missing app mount target");
}

const view = new URLSearchParams(window.location.search).get("view");
const app = mount(view === "capsule" ? CapsuleApp : App, { target });

export default app;
