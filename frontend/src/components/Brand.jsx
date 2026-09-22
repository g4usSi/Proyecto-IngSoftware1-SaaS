import { Link } from 'react-router-dom';

export function Brand({ light = false }) {
  return (
    <Link className={`brand${light ? ' brand-light' : ''}`} to="/" aria-label="SmartStorage, inicio">
      <svg className="brand-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2 19 6.2V17.8L12 22 5 17.8V6.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path className="brand-accent" d="M12 7v10M7.2 9.4l9.6 5.2M7.2 14.6l9.6-5.2" strokeWidth="1.4" />
      </svg>
      <span>SmartStorage</span>
    </Link>
  );
}
