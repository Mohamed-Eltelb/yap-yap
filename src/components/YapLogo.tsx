import { Minus, Square, X } from 'lucide-react';

export function YapLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Clean geometric speech-wave emblem matching reference silhouette */}
      <path
        d="M5.5 5.2C11.4 4.2 17.5 6.9 19.2 12.2C19.8 14.2 19.3 16.5 17.8 18.2C16.2 19.9 13.7 20.3 11.7 19.1C10.5 18.4 9.7 17.1 9.5 15.6C9.3 13.7 10.6 11.9 12.5 11.4C13.7 11.1 14.9 11.7 15.4 12.7C14.1 12.6 12.9 13.5 12.7 14.8C12.6 15.9 13.4 16.9 14.5 17C15.8 17.1 16.7 15.8 16.4 14.2C15.9 11.1 12.8 8.9 8.7 8.8C7.1 8.8 5.7 9.2 4.6 9.8C4.4 8.1 4.7 6.4 5.5 5.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function WindowControls() {
  const isElectron = Boolean(window.yapyap?.isElectron);

  const handleMinimize = () => {
    window.yapyap?.minimizeWindow();
  };

  const handleMaximize = () => {
    window.yapyap?.maximizeWindow();
  };

  const handleClose = () => {
    window.yapyap?.closeWindow();
  };

  if (!isElectron) {
    return (
      <div className="flex items-center gap-1 app-no-drag opacity-55">
        <span className="w-8 h-7 inline-flex items-center justify-center rounded-md text-[var(--text-secondary)]">
          <Minus className="w-3.5 h-3.5" />
        </span>
        <span className="w-8 h-7 inline-flex items-center justify-center rounded-md text-[var(--text-secondary)]">
          <Square className="w-3 h-3" />
        </span>
        <span className="w-8 h-7 inline-flex items-center justify-center rounded-md text-[var(--text-secondary)]">
          <X className="w-3.5 h-3.5" />
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5 app-no-drag">
      <button
        type="button"
        onClick={handleMinimize}
        title="Minimize"
        className="w-9 h-7 inline-flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={handleMaximize}
        title="Maximize"
        className="w-9 h-7 inline-flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
      >
        <Square className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={handleClose}
        title="Close"
        className="w-9 h-7 inline-flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-red-500 hover:text-white transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
