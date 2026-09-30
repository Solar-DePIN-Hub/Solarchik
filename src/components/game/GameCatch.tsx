import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  onReset?: () => void;
};

type State = { hit: boolean };

export class GameCatch extends Component<Props, State> {
  state: State = { hit: false };

  static getDerivedStateFromError(): State {
    return { hit: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Solarchik render", error, info);
  }

  private reset = () => {
    this.props.onReset?.();
    this.setState({ hit: false });
  };

  render() {
    if (!this.state.hit) return this.props.children;
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-fg">
        <p className="font-display text-2xl font-semibold">Solarchik</p>
        <p className="max-w-[32ch] text-sm text-muted">The yard hiccuped. Your suns are safe.</p>
        <button
          type="button"
          onClick={this.reset}
          className="flex h-12 items-center justify-center rounded-lg bg-primary px-6 font-display text-base font-semibold text-primary-fg"
        >
          Back to yard
        </button>
      </div>
    );
  }
}
