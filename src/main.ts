import "@/style.css";
import { Game } from "@/core/Game";

function boot(): void {
  const canvas = document.getElementById("scene-canvas") as HTMLCanvasElement | null;
  const uiRoot = document.getElementById("ui-root") as HTMLElement | null;
  if (!canvas || !uiRoot) {
    throw new Error("Hollow Creek Farm: required DOM nodes (#scene-canvas / #ui-root) are missing.");
  }

  const game = new Game(canvas, uiRoot);
  void game.start();
}

boot();
