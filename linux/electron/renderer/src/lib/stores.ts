import { writable } from "svelte/store";
import { ROUTES, type RouteId } from "./types";

export const activeRoute = writable<RouteId>("home");

export function routeLabel(routeId: RouteId): string {
	return ROUTES.find((route) => route.id === routeId)?.label ?? "Home";
}
