import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, ArrowUp, Check, Clock3, CloudUpload, CopyCheck, Download, Fingerprint,
  FolderClosed, HardDrive, KeyRound, LockKeyhole, MapPinOff, Maximize2, ShieldCheck, Sparkles, Zap,
} from 'lucide-react';
import { Brand } from '../components/Brand.jsx';
import { ServiceStatus } from '../components/ServiceStatus.jsx';
import { useSession } from '../features/auth/session.jsx';
import { plans } from '../features/subscriptions/plans.data.js';
import { CompressionDemo } from './landing/CompressionDemo.jsx';
import { Faq } from './landing/Faq.jsx';
import { HeroShader } from './landing/HeroShader.jsx';
import { SavingsCalculator } from './landing/SavingsCalculator.jsx';
import { SiteNav, sections } from './landing/SiteNav.jsx';
import { prefersReducedMotion, trackPointer, useRevealOnScroll } from './landing/motion.js';

const headline = [['Tus', 'imágenes.'], ['Más', 'ligeras.'], ['Igual', 'de', 'tuyas.']];

const heroFacts = [
  { icon: HardDrive, text: '2 GB gratis' },
  { icon: CloudUpload, text: 'Hasta 25 MB por imagen' },
  { icon: Maximize2, text: 'Misma resolución' },
];


const steps = [
  { icon: CloudUpload, tag: 'JPG · PNG · WebP', title: 'Sube tu imagen', text: 'Elige un archivo de hasta 25 MB. Antes de aceptarlo comprobamos que de verdad sea una imagen válida, no solo que lo parezca por su nombre.' },
  { icon: Fingerprint, tag: 'SHA-256', title: 'Le damos una huella', text: 'Calculamos el SHA-256 de los bytes originales: un identificador único de ese contenido. Dos archivos idénticos siempre tienen la misma huella.' },
  { icon: Sparkles, tag: 'Calidad 80', title: 'La convertimos a WebP', text: 'Misma resolución, bastante menos peso. Enderezamos la orientación y eliminamos los metadatos EXIF, incluida la ubicación GPS.' },
  { icon: CopyCheck, tag: 'Deduplicación global', title: 'Guardamos una sola copia', text: 'Si ese contenido ya existía, se reutiliza en lugar de duplicarlo. Tú ves tu imagen en tu biblioteca y nadie más puede verla.' },
];

const benefits = [
  { icon: Zap, title: 'Carga más rápido', text: 'WebP pesa menos que JPG o PNG con una calidad visual muy similar. Tus imágenes están listas para usarse en la web.', wide: true },
  { icon: Maximize2, title: 'Ni un píxel menos', text: 'Convertimos sin redimensionar: el ancho y el alto son los mismos que subiste.' },
  { icon: CopyCheck, title: 'Adiós a los duplicados', text: 'El mismo archivo no ocupa espacio dos veces en el sistema.' },
  { icon: Download, title: 'Descarga en un clic', text: 'Recupera tu WebP cuando lo necesites, con su nombre original.' },
  { icon: FolderClosed, title: 'Álbumes', text: 'Organiza tus imágenes en carpetas.', soon: true },
];

const privacy = [
  { icon: LockKeyhole, title: 'Solo tú accedes', text: 'Cada imagen pertenece a tu cuenta. Se lista y se descarga únicamente con tu sesión.' },
  { icon: MapPinOff, title: 'Sin rastro de ubicación', text: 'Quitamos los datos EXIF y GPS de tus fotos al convertirlas.' },
  { icon: Fingerprint, title: 'La huella no es una llave', text: 'Conocer el hash de un archivo no da acceso a él. Compartir copia en el disco no significa compartir la imagen.' },
  { icon: KeyRound, title: 'Sesiones que caducan', text: 'Contraseñas cifradas con un hash seguro y sesiones con vencimiento; al cerrar sesión, el acceso se revoca.' },
];



function MagneticLink({ to, href, className, children }) {
  const ref = useRef(null);
  const move = (event) => {
    if (prefersReducedMotion()) return;
    const rect = ref.current.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    ref.current.style.transform = `translate(${x * 0.18}px, ${y * 0.28}px)`;
  };
  const leave = () => { ref.current.style.transform = ''; };
  const props = { ref, className: `magnetic ${className}`, onPointerMove: move, onPointerLeave: leave };
  return to ? <Link to={to} {...props}>{children}</Link> : <a href={href} {...props}>{children}</a>;
}

function StepsSection() {
  const sectionRef = useRef(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    const cards = [...section.querySelectorAll('.step-card')];
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) setActive(Number(entry.target.dataset.index)); });
    }, { rootMargin: '-45% 0px -45% 0px' });
    cards.forEach((card) => observer.observe(card));

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = section.querySelector('.steps-list').getBoundingClientRect();
      const progress = (window.innerHeight * 0.5 - rect.top) / rect.height;
      section.style.setProperty('--steps-progress', String(Math.min(1, Math.max(0, progress))));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { observer.disconnect(); window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);

  return (
    <section className="steps-section" id="proceso" aria-labelledby="steps-title" ref={sectionRef}>
      <div className="content-width steps-layout">
        <div className="steps-intro">
          <span className="eyebrow" data-reveal>CÓMO FUNCIONA</span>
          <h2 id="steps-title" data-reveal data-reveal-delay="80">De tu carpeta a tu biblioteca en cuatro pasos.</h2>
          <p data-reveal data-reveal-delay="160">Todo ocurre al momento de subir: cuando la imagen aparece en tu biblioteca, ya está convertida y protegida.</p>
          <ol className="steps-rail" aria-hidden="true">
            {steps.map((step, index) => <li key={step.title} className={index <= active ? 'is-on' : undefined}><span>0{index + 1}</span>{step.title}</li>)}
          </ol>
        </div>
        <ol className="steps-list">
          <span className="steps-line" aria-hidden="true"><i /></span>
          {steps.map(({ icon: StepIcon, tag, title, text }, index) => (
            <li className={`step-card${index === active ? ' is-active' : ''}`} key={title} data-index={index} data-reveal>
              <span className="step-node" aria-hidden="true">0{index + 1}</span>
              <div className="step-icon" aria-hidden="true"><StepIcon strokeWidth={1.6} /></div>
              <span className="step-tag">{tag}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function LandingPage() {
  const rootRef = useRef(null);
  const { session } = useSession();
  useRevealOnScroll(rootRef);

  // Los enlaces internos (#seccion) se deslizan en vez de saltar.
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const root = document.documentElement;
    root.style.scrollBehavior = 'smooth';
    return () => { root.style.scrollBehavior = ''; };
  }, []);

  // Al llegar desde otra página con #seccion (p. ej. /#preguntas), bajar hasta ella.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return undefined;
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView(), 120);
    return () => clearTimeout(timer);
  }, []);

  // Parallax suave del contenido del hero al bajar.
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      rootRef.current?.style.setProperty('--hero-scroll', String(Math.min(1, window.scrollY / window.innerHeight)));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);

  const startTo = session ? '/app' : '/register';

  return (
    <div className="landing" ref={rootRef}>
      <SiteNav />

      <main id="main-content">
        <section className="hero" aria-labelledby="hero-title">
          <HeroShader />
          <div className="hero-inner content-width">
            <div className="hero-copy">
              <h1 id="hero-title" aria-label="Tus imágenes. Más ligeras. Igual de tuyas.">
                {headline.map((line, lineIndex) => (
                  <span className={`hero-line${lineIndex === 2 ? ' is-accent' : ''}`} key={line.join()} aria-hidden="true">
                    {line.map((word, wordIndex) => (
                      <span className="hero-word" key={word} style={{ '--w': lineIndex * 2 + wordIndex }}><span>{word}</span></span>
                    ))}
                  </span>
                ))}
              </h1>
              <p className="hero-lede">Sube tus fotos y guárdalas convertidas a WebP: la misma resolución, menos peso, sin datos de ubicación y sin copias repetidas.</p>
              <div className="hero-actions">
                <MagneticLink to={startTo} className="button button-orange hero-cta">{session ? 'Ir a mi biblioteca' : 'Empieza gratis'}<ArrowRight strokeWidth={2} className="icon" /></MagneticLink>
                <a className="hero-secondary" href="#proceso">Ver cómo funciona<span aria-hidden="true"><ArrowRight strokeWidth={2} /></span></a>
              </div>
              <ul className="hero-facts">
                {heroFacts.map(({ icon: FactIcon, text }) => <li key={text}><FactIcon strokeWidth={1.8} aria-hidden="true" />{text}</li>)}
              </ul>
            </div>
            <div className="hero-visual"><CompressionDemo /></div>
          </div>
        </section>

        <StepsSection />

        <section className="savings-section" id="ahorro" aria-labelledby="savings-title">
          <div className="content-width">
            <div className="section-head">
              <span className="eyebrow" data-reveal>CALCULA TU AHORRO</span>
              <h2 id="savings-title" data-reveal data-reveal-delay="80">¿Cuánto pesarían tus imágenes en WebP?</h2>
              <p data-reveal data-reveal-delay="160">Mueve los controles y mira la diferencia. Es una estimación: en tu biblioteca verás el tamaño original y el WebP real de cada imagen.</p>
            </div>
            <div data-reveal data-reveal-delay="200"><SavingsCalculator /></div>
          </div>
        </section>

        <section className="benefits-section" aria-labelledby="benefits-title">
          <div className="content-width">
            <div className="section-head">
              <span className="eyebrow" data-reveal>POR QUÉ SMARTSTORAGE</span>
              <h2 id="benefits-title" data-reveal data-reveal-delay="80">Menos peso. Nada que perder.</h2>
            </div>
            <div className="bento">
              {benefits.map(({ icon: BenefitIcon, title, text, wide, soon }, index) => (
                <article className={`bento-card${wide ? ' is-wide' : ''}${soon ? ' is-soon' : ''}`} key={title} onPointerMove={trackPointer} data-reveal data-reveal-delay={index * 70}>
                  <span className="bento-icon" aria-hidden="true"><BenefitIcon strokeWidth={1.6} /></span>
                  {soon && <span className="soon-badge">Próximamente</span>}
                  <h3>{title}</h3>
                  <p>{text}</p>
                  {wide && (
                    <div className="bento-compare" aria-hidden="true">
                      <div><span>PNG</span><i style={{ '--w': '100%' }} /></div>
                      <div><span>JPG</span><i style={{ '--w': '62%' }} /></div>
                      <div className="is-webp"><span>WebP</span><i style={{ '--w': '38%' }} /></div>
                      <small>Comparación ilustrativa del peso de una misma foto</small>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="privacy-section" id="privacidad" aria-labelledby="privacy-title">
          <div className="content-width privacy-layout">
            <div className="privacy-intro">
              <span className="eyebrow" data-reveal>PRIVACIDAD</span>
              <h2 id="privacy-title" data-reveal data-reveal-delay="80">Compartimos espacio en disco.<br /><span>Nunca tus imágenes.</span></h2>
              <p data-reveal data-reveal-delay="160">La deduplicación ahorra almacenamiento, pero el acceso siempre se decide por tu cuenta, nunca por el contenido del archivo.</p>
              <div className="privacy-shield" aria-hidden="true" data-reveal data-reveal-delay="220">
                <span className="ring" /><span className="ring" /><span className="ring" />
                <ShieldCheck strokeWidth={1.4} />
              </div>
            </div>
            <div className="privacy-grid">
              {privacy.map(({ icon: PrivacyIcon, title, text }, index) => (
                <article className="privacy-card" key={title} onPointerMove={trackPointer} data-reveal data-reveal-delay={index * 90}>
                  <PrivacyIcon strokeWidth={1.6} aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="plans-section" id="planes" aria-labelledby="plans-title">
          <div className="content-width">
            <div className="section-head is-center">
              <span className="eyebrow" data-reveal>PLANES</span>
              <h2 id="plans-title" data-reveal data-reveal-delay="80">Empieza gratis. Crece cuando lo necesites.</h2>
            </div>
            <div className="plans-grid">
              {plans.map((plan, index) => (
                <article className={`plan-tile${plan.featured ? ' is-featured' : ''}`} key={plan.name} onPointerMove={trackPointer} data-reveal data-reveal-delay={index * 90}>
                  <div className="plan-tile-head">
                    <h3>{plan.name}</h3>
                    {plan.featured && <span className="plan-chip is-hot">Recomendado</span>}
                  </div>
                  <p className="plan-price"><strong>{plan.price}</strong><span>/ mes</span></p>
                  <p className="plan-desc">{plan.description}</p>
                  <ul>{plan.features.map((item) => <li key={item}><Check strokeWidth={2.4} aria-hidden="true" />{item}</li>)}</ul>
                  {plan.available
                    ? <MagneticLink to={startTo} className="button button-orange">{session ? 'Ir a mi biblioteca' : 'Empezar gratis'}<ArrowRight strokeWidth={2} className="icon" /></MagneticLink>
                    : <span className="plan-soon" title="Los pagos todavía no están habilitados"><Clock3 strokeWidth={2} aria-hidden="true" />{plan.cta} · Próximamente</span>}
                </article>
              ))}
            </div>
            <p className="plans-note" data-reveal>Precios en quetzales. Hoy puedes crear tu cuenta con el plan Free; la contratación de los planes de pago estará disponible pronto.</p>
          </div>
        </section>

        <section className="faq-section" id="preguntas" aria-labelledby="faq-title">
          <div className="content-width faq-layout">
            <div className="section-head">
              <span className="eyebrow" data-reveal>PREGUNTAS FRECUENTES</span>
              <h2 id="faq-title" data-reveal data-reveal-delay="80">Lo que suelen preguntarnos.</h2>
              <p data-reveal data-reveal-delay="160">¿No encuentras tu respuesta? Crea una cuenta y pruébalo: el plan Free no te pide ningún pago.</p>
            </div>
            <Faq />
          </div>
        </section>

        <section className="cta-section" aria-labelledby="cta-title">
          <div className="content-width cta-inner" data-reveal>
            <div className="cta-orbs" aria-hidden="true"><span /><span /><span /></div>
            <h2 id="cta-title">Tus imágenes merecen<br /><span>pesar menos.</span></h2>
            <p>Crea tu cuenta y empieza con 2 GB gratis.</p>
            <MagneticLink to={startTo} className="button button-orange hero-cta">{session ? 'Ir a mi biblioteca' : 'Empieza gratis'}<ArrowRight strokeWidth={2} className="icon" /></MagneticLink>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="content-width footer-grid">
          <div className="footer-brand">
            <Brand light />
            <p>Almacenamiento de imágenes que convierte a WebP, elimina duplicados y cuida tu privacidad.</p>
            <ServiceStatus />
          </div>
          <nav className="footer-col" aria-label="Producto">
            <h2>Producto</h2>
            {sections.map(({ id, label }) => <a key={id} href={`#${id}`}>{label}</a>)}
          </nav>
          <nav className="footer-col" aria-label="Cuenta">
            <h2>Cuenta</h2>
            {session
              ? <Link to="/app">Mi biblioteca</Link>
              : <><Link to="/register">Crear cuenta</Link><Link to="/login">Iniciar sesión</Link></>}
            <Link to="/app/plans">Planes</Link>
          </nav>
          <div className="footer-col">
            <h2>Formatos</h2>
            <span>Entrada: JPG, PNG y WebP</span>
            <span>Salida: WebP (calidad 80)</span>
            <span>Máximo 25 MB por imagen</span>
          </div>
        </div>
        <div className="content-width footer-bottom">
          <span>© {new Date().getFullYear()} SmartStorage · Proyecto de Ingeniería de Software I</span>
          <a href="#main-content" className="to-top" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); }}>Volver arriba <ArrowUp strokeWidth={2} aria-hidden="true" /></a>
        </div>
      </footer>
    </div>
  );
}
