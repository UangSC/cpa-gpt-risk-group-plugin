export const Icon = {
  Search: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  Refresh: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M13 8a5 5 0 1 1-1.6-3.7M13 3.2V6h-2.8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Close: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  Play: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="m4 2.8 9 5.2-9 5.2V2.8Z" fill="currentColor" />
    </svg>
  ),
  Stop: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
    </svg>
  ),
  Chevron: ({ dir = 'down' }: { dir?: 'down' | 'right' }) => (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ transform: dir === 'right' ? 'rotate(-90deg)' : undefined }}
    >
      <path d="m4 6.5 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Moon: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Sun: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="2.7" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  ),
  Alert: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M8 2.8 14 13H2L8 2.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.4v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.3" r="0.75" fill="currentColor" />
    </svg>
  ),
  Eye: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M1.7 8S4.1 3.9 8 3.9 14.3 8 14.3 8 11.9 12.1 8 12.1 1.7 8 1.7 8Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  ),
  EyeOff: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M1.7 8S4.1 3.9 8 3.9 14.3 8 14.3 8 11.9 12.1 8 12.1 1.7 8 1.7 8Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path d="M2.6 2.6l10.8 10.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="m3.5 8.5 3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Layers: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="m8 2 6 3.2-6 3.2L2 5.2 8 2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="m2.6 8.5 5.4 2.9 5.4-2.9" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  ),
  History: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M2.6 8a5.4 5.4 0 1 0 1.7-3.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M2.4 2.9v2.6H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 5.4V8l1.9 1.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  Cog: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 1.9v1.3M8 12.8v1.3M1.9 8h1.3M12.8 8h1.3M3.7 3.7l.9.9M11.4 11.4l.9.9M12.3 3.7l-.9.9M4.6 11.4l-.9.9"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  ),
  Info: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 7.3v3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="5.2" r="0.7" fill="currentColor" />
    </svg>
  ),
  Doc: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M3.2 1.8h6.1L13.2 5.8V14H3.2V1.8Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M9.3 1.9v4h3.6M5.4 8.2h5.6M5.4 10.7h4.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  Sync: () => (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M12.6 6.4A4.8 4.8 0 0 0 4 4.4M3.4 9.6A4.8 4.8 0 0 0 12 11.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path d="M12.8 2.9v3.7H9.1M3.2 13.1V9.4h3.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Columns2: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <rect x="2.2" y="2.6" width="4.8" height="10.8" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2.6" width="4.8" height="10.8" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  List: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M5.5 4h8M5.5 8h8M5.5 12h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="2.8" cy="4" r="0.8" fill="currentColor" />
      <circle cx="2.8" cy="8" r="0.8" fill="currentColor" />
      <circle cx="2.8" cy="12" r="0.8" fill="currentColor" />
    </svg>
  ),
  Grid: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <rect x="2.3" y="2.3" width="4.7" height="4.7" rx="1.1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2.3" width="4.7" height="4.7" rx="1.1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2.3" y="9" width="4.7" height="4.7" rx="1.1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="4.7" height="4.7" rx="1.1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  CheckAll: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M2.2 8.2 4.8 10.8 10 4.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.8 10.8 8.3 12.2 13.8 5.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Sliders: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M2.5 5h11M2.5 11h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6" cy="5" r="1.6" fill="var(--surface, #fff)" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10.5" cy="11" r="1.6" fill="var(--surface, #fff)" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  Shield: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M8 2.2 13 4.1v3.7c0 3-2.1 5.3-5 6.1-2.9-.8-5-3.1-5-6.1V4.1L8 2.2Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="m6 8.1 1.4 1.4 2.8-2.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Cpu: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6.5" y="6.5" width="3" height="3" rx="0.5" fill="currentColor" />
      <path
        d="M6.2 2v2.2M9.8 2v2.2M6.2 11.8V14M9.8 11.8V14M2 6.2h2.2M2 9.8h2.2M11.8 6.2H14M11.8 9.8H14"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  ),
  Database: () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <ellipse cx="8" cy="4.2" rx="4.8" ry="1.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.2 4.2v7.6c0 1 2.1 1.8 4.8 1.8s4.8-.8 4.8-1.8V4.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.2 8c0 1 2.1 1.8 4.8 1.8s4.8-.8 4.8-1.8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
}
