import { type JSX, useCallback, useState } from 'react';
import { nativeHostService } from '../../../../platform/native/browser/nativeHostService.js';
import { fileUrl } from '../../../services/files/common/fileResource.js';
import { color, font, radius, shadow, space } from '../../style/design.js';
import { Button } from '../../ui/primitives/Button.js';

export const AudioEditorPane = ({
  absPath,
  basename,
}: {
  absPath: string;
  basename: string;
}): JSX.Element => (
  <div
    style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[4],
      padding: space[6],
      background: color.surfaceMuted,
    }}
  >
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: radius.xl,
        background: color.surface,
        border: `1px solid ${color.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: color.textTertiary,
      }}
    >
      <svg
        width={26}
        height={26}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M4 7v2M6.5 4.8v6.4M9 3.2v9.6M11.5 5.6v4.8" />
      </svg>
    </div>
    <div
      style={{
        fontSize: font.size.body,
        fontWeight: font.weight.medium,
        color: color.textPrimary,
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {basename}
    </div>
    <audio controls src={fileUrl(absPath)} style={{ width: '100%', maxWidth: 360 }}>
      <track kind="captions" />
    </audio>
  </div>
);

export const VideoEditorPane = ({ absPath }: { absPath: string }): JSX.Element => (
  <div
    style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: space[4],
      background: '#1b1b1d',
    }}
  >
    <video
      controls
      src={fileUrl(absPath)}
      style={{
        width: '100%',
        maxHeight: '100%',
        borderRadius: radius.lg,
        boxShadow: shadow.raised,
      }}
    >
      <track kind="captions" />
    </video>
  </div>
);

export const UnsupportedFileEditorPane = ({
  file,
  absPath,
}: {
  file: string;
  absPath: string;
}): JSX.Element => {
  const [error, setError] = useState<string | null>(null);
  const openInApp = useCallback(async () => {
    setError(null);
    try {
      const res = await nativeHostService.openPath(file);
      if (!res.ok) setError(res.error ?? "Couldn't open the file.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [file]);
  return (
    <div
      style={{
        padding: space[4],
        fontFamily: font.sans,
        fontSize: font.size.body,
        color: color.textSecondary,
        display: 'flex',
        flexDirection: 'column',
        gap: space[3],
        alignItems: 'flex-start',
      }}
    >
      <p style={{ margin: 0 }}>No built-in viewer for this file type.</p>
      <Button variant="primary" onClick={() => void openInApp()}>
        Open in default app
      </Button>
      {error !== null && (
        <p style={{ margin: 0, color: color.danger, fontSize: font.size.caption }}>{error}</p>
      )}
      <p
        style={{
          fontFamily: font.mono,
          fontSize: font.size.micro,
          color: color.textTertiary,
          margin: 0,
          wordBreak: 'break-all',
        }}
      >
        {absPath}
      </p>
    </div>
  );
};

export const PdfEditorPane = ({ absPath }: { absPath: string }): JSX.Element => (
  <iframe
    title="PDF"
    src={fileUrl(absPath)}
    style={{ width: '100%', height: '100%', border: 'none' }}
  />
);

const checkerboard = {
  backgroundColor: color.surface,
  backgroundImage: `linear-gradient(45deg, ${color.surfaceMuted} 25%, transparent 25%), linear-gradient(-45deg, ${color.surfaceMuted} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${color.surfaceMuted} 75%), linear-gradient(-45deg, transparent 75%, ${color.surfaceMuted} 75%)`,
  backgroundSize: '18px 18px',
  backgroundPosition: '0 0, 0 9px, 9px -9px, -9px 0',
} as const;

export const ImageEditorPane = ({ absPath }: { absPath: string }): JSX.Element => {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: space[4],
        ...checkerboard,
      }}
    >
      <img
        src={fileUrl(absPath)}
        alt={absPath}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          objectFit: 'contain',
          imageRendering: 'pixelated',
        }}
        onLoad={(event) => {
          const img = event.currentTarget;
          setDims({ w: img.naturalWidth, h: img.naturalHeight });
        }}
      />
      {dims && (
        <span
          style={{
            position: 'absolute',
            bottom: space[3],
            right: space[3],
            fontFamily: font.mono,
            fontSize: font.size.micro,
            color: color.textSecondary,
            background: 'rgba(0, 0, 0, 0.6)',
            border: `1px solid ${color.border}`,
            borderRadius: radius.pill,
            padding: `2px ${space[2]}px`,
            backdropFilter: 'blur(4px)',
          }}
        >
          {dims.w} × {dims.h}
        </span>
      )}
    </div>
  );
};
