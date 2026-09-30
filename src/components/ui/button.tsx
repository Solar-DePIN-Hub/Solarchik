import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium select-none disabled:pointer-events-none disabled:opacity-40 active:not-disabled:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:bg-accent-hover",
        ghost: "bg-elevated text-fg border border-border hover:bg-surface",
        danger: "bg-danger text-fg hover:opacity-90",
      },
      size: {
        md: "h-11 min-h-11 px-4 rounded-md text-sm",
        lg: "h-12 min-h-12 px-5 rounded-lg text-base",
        sm: "h-10 min-h-10 px-3 rounded-sm text-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type Props = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: Props) {
  return (
    <button
      type={type}
      className={cn(
        buttonVariants({ variant, size }),
        "transition-transform duration-150 ease-out",
        className,
      )}
      {...props}
    />
  );
}
