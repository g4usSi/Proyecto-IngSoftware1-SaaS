import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon.jsx';
import { IMAGE_ACCEPT, validateImage } from './storage.api.js';

export function UploadForm({ onUpload, busy, error, notice }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [validation, setValidation] = useState(null);

  function selectFile(event) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setValidation(selected ? validateImage(selected) : null);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const message = validateImage(file);
    setValidation(message);
    if (message) return;
    if (await onUpload(file)) {
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <section className="library-panel storage-upload" aria-labelledby="storage-upload-title">
      <div className="panel-heading"><span id="storage-upload-title"><Icon name="upload" /> Subir una imagen</span><span className="small-badge">WebP</span></div>
      <form className="storage-upload-form" onSubmit={submit} aria-busy={busy}>
        <label className="storage-file-label" htmlFor="storage-file">Selecciona un archivo</label>
        <div className="storage-upload-controls">
          <input ref={inputRef} id="storage-file" type="file" accept={IMAGE_ACCEPT} onChange={selectFile} disabled={busy} aria-describedby="storage-upload-help storage-upload-feedback" aria-invalid={Boolean(validation)} />
          <button className="button button-dark" type="submit" disabled={busy || !file || Boolean(validation)}><Icon name="upload" />{busy ? 'Procesando imagen…' : 'Subir imagen'}</button>
        </div>
        <p className="storage-help" id="storage-upload-help">JPG, PNG o WebP estáticos · Máximo 25 MB y 40 megapíxeles. Se conservará únicamente la versión WebP.</p>
        <div id="storage-upload-feedback">
          {(validation || error) && <p className="storage-message storage-message-error" role="alert">{validation || error}</p>}
          {busy && <p className="storage-message" role="status">Subiendo y optimizando la imagen. Espera a que termine el proceso.</p>}
          {!busy && notice && !validation && !error && <p className="storage-message" role="status">{notice}</p>}
        </div>
      </form>
    </section>
  );
}
