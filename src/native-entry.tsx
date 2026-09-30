import { createRoot } from "react-dom/client";
import { GameApp } from "@/components/game/GameApp";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<GameApp />);
