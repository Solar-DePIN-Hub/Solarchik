import { robotPortrait, type RobotId } from "@/lib/game/robots";

export function RobotPortrait({
  id,
  className = "",
  pose = "front",
}: {
  id: RobotId;
  className?: string;
  pose?: "front" | "yard" | "side";
}) {
  const src = robotPortrait(id, pose);
  return (
    <div className={"relative overflow-hidden " + className} aria-hidden>
      <img
        src={src}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-contain object-bottom select-none"
      />
    </div>
  );
}
