/* Fuel Kicks theme script. No dependencies. */
(() => {
  const fk = window.fk || {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- Analytics: forwards to Shopify customer events when available ---------- */
  const track = (name, detail = {}) => {
    try {
      if (window.Shopify && Shopify.analytics && typeof Shopify.analytics.publish === 'function') {
        Shopify.analytics.publish(name, detail);
      }
    } catch (e) {
      /* ignore */
    }
    document.dispatchEvent(new CustomEvent(`fk:${name}`, { detail }));
  };
  fk.track = track;

  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-fk-track]');
    if (el) track(el.dataset.fkTrack, { href: el.getAttribute('href') || '' });
  });

  /* ---------- Dialogs (menu, search, cart, size guide) ---------- */
  let lastTrigger = null;
  const openDialog = (dialog, trigger) => {
    if (!dialog || typeof dialog.showModal !== 'function') return false;
    lastTrigger = trigger || document.activeElement;
    if (!dialog.open) dialog.showModal();
    const focusTarget = $('[autofocus]', dialog);
    if (focusTarget) focusTarget.focus();
    return true;
  };
  fk.openDialog = openDialog;

  document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-fk-open]');
    if (opener) {
      const dialog = document.getElementById(opener.dataset.fkOpen);
      if (openDialog(dialog, opener)) {
        event.preventDefault();
        if (opener.dataset.fkOpen.startsWith('SizeGuide')) track('size_guide_open');
      }
      return;
    }
    const closer = event.target.closest('[data-fk-close]');
    if (closer) {
      const dialog = closer.closest('dialog');
      if (dialog) dialog.close();
      return;
    }
    if (event.target instanceof HTMLDialogElement) {
      // A click on the backdrop lands on the dialog element itself
      const rect = event.target.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) event.target.close();
    }
  });

  document.addEventListener(
    'close',
    (event) => {
      if (event.target instanceof HTMLDialogElement && lastTrigger && document.contains(lastTrigger)) {
        lastTrigger.focus();
        lastTrigger = null;
      }
    },
    true
  );

  /* ---------- Announcement rotation (mobile shows one at a time) ---------- */
  const rotator = $('[data-fk-rotate]');
  if (rotator && rotator.children.length > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let i = 0;
    let paused = false;
    rotator.addEventListener('mouseenter', () => (paused = true));
    rotator.addEventListener('mouseleave', () => (paused = false));
    rotator.addEventListener('focusin', () => (paused = true));
    rotator.addEventListener('focusout', () => (paused = false));
    setInterval(() => {
      if (paused) return;
      rotator.children[i].classList.remove('is-active');
      i = (i + 1) % rotator.children.length;
      rotator.children[i].classList.add('is-active');
    }, 4500);
  }

  /* ---------- Money ---------- */
  const formatMoney = (cents) => {
    const amount = (cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    const format = fk.moneyFormat || '₹{{amount}}';
    return format.replace(/\{\{\s*[a-z_]+\s*\}\}/, amount);
  };
  fk.formatMoney = formatMoney;

  /* ---------- Cart ---------- */
  const CART_SECTION = 'cart-drawer';
  const sectionsUrl = () => window.location.pathname;

  const updateCount = (count) => {
    $$('[data-fk-cart-count]').forEach((el) => {
      el.textContent = count;
      el.hidden = Number(count) === 0;
    });
    $$('[data-fk-cart-toggle]').forEach((el) => {
      el.setAttribute('aria-label', `Cart, ${count} items`);
      el.classList.remove('is-bumped');
      void el.offsetWidth; // restart the animation
      el.classList.add('is-bumped');
    });
  };

  const renderDrawer = (html) => {
    if (!html) return;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const fresh = $('[data-fk-cart-inner]', doc);
    const current = $('[data-fk-cart-inner]');
    if (fresh && current) {
      current.replaceWith(fresh);
      updateCount(fresh.dataset.count || 0);
    }
  };

  const fetchDrawer = async () => {
    const res = await fetch(`${sectionsUrl()}?sections=${CART_SECTION}`);
    const data = await res.json();
    renderDrawer(data[CART_SECTION]);
  };

  const openCart = (trigger) => {
    const drawer = document.getElementById('CartDrawer');
    if (drawer && fk.cartDrawer && document.body.classList.contains('template-cart') === false) {
      openDialog(drawer, trigger);
      return true;
    }
    return false;
  };

  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-fk-cart-toggle]');
    if (toggle && openCart(toggle)) event.preventDefault();
  });

  // Add to cart
  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-fk-product-form]');
    if (!form) return;
    if (!fk.cartDrawer) return; // fall back to a normal post to /cart
    event.preventDefault();

    const button = $('[type="submit"]', form);
    const errorBox = $('[data-fk-form-error]', form);
    if (button) {
      button.classList.add('is-loading');
      button.setAttribute('aria-disabled', 'true');
    }
    if (errorBox) errorBox.hidden = true;

    const body = new FormData(form);
    body.append('sections', CART_SECTION);
    body.append('sections_url', sectionsUrl());

    try {
      const res = await fetch(`${fk.routes.cartAdd}.js`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body,
      });
      const data = await res.json();
      if (!res.ok || data.status) {
        if (errorBox) {
          errorBox.textContent = data.description || data.message || 'Could not add to cart. Please try again.';
          errorBox.hidden = false;
        }
        return;
      }
      if (data.sections) renderDrawer(data.sections[CART_SECTION]);
      else await fetchDrawer();
      track('add_to_cart', { product_id: data.product_id, variant_id: data.variant_id, quantity: data.quantity });
      openCart(button);
    } catch (e) {
      form.submit();
    } finally {
      if (button) {
        button.classList.remove('is-loading');
        button.removeAttribute('aria-disabled');
      }
    }
  });

  // Change quantities (drawer and cart page)
  const changeLine = async (line, quantity, container) => {
    container?.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(`${fk.routes.cartChange}.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ line, quantity, sections: [CART_SECTION], sections_url: sectionsUrl() }),
      });
      const data = await res.json();
      if (!res.ok) {
        const err = $('[data-fk-cart-error]');
        if (err) {
          err.textContent = data.description || data.message || 'Could not update the cart.';
          err.hidden = false;
        }
        return;
      }
      if (document.body.classList.contains('template-cart')) {
        window.location.reload();
        return;
      }
      if (data.sections) renderDrawer(data.sections[CART_SECTION]);
      else await fetchDrawer();
      const live = $('[data-fk-cart-live]');
      if (live) live.textContent = `Cart updated. ${data.item_count} items.`;
    } finally {
      container?.removeAttribute('aria-busy');
    }
  };

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-fk-line-change]');
    if (!btn) return;
    event.preventDefault();
    const line = Number(btn.dataset.line);
    const qty = Math.max(0, Number(btn.dataset.qty));
    changeLine(line, qty, btn.closest('[data-fk-cart-inner], form'));
  });

  document.addEventListener('change', (event) => {
    const input = event.target.closest('[data-fk-line-input]');
    if (!input) return;
    changeLine(Number(input.dataset.line), Math.max(0, Number(input.value) || 0), input.closest('[data-fk-cart-inner], form'));
  });

  // Refresh drawer when the page is restored from the back/forward cache
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && $('[data-fk-cart-inner]')) fetchDrawer();
  });

  /* ---------- Quantity steppers on product forms ---------- */
  document.addEventListener('click', (event) => {
    const step = event.target.closest('[data-fk-step]');
    if (!step) return;
    const input = $('input', step.closest('.qty'));
    if (!input) return;
    const min = Number(input.min) || 1;
    const max = Number(input.max) || 99;
    const next = Math.min(max, Math.max(min, (Number(input.value) || min) + Number(step.dataset.fkStep)));
    input.value = next;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  /* ---------- Tabs ---------- */
  $$('[data-fk-tabs]').forEach((root) => {
    const tabs = $$('[role="tab"]', root);
    const select = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        select(next);
      });
    });
  });

  /* ---------- Before / after slider ---------- */
  $$('[data-fk-compare]').forEach((root) => {
    const range = $('input[type="range"]', root);
    if (!range) return;
    const set = () => root.style.setProperty('--pos', `${range.value}%`);
    range.addEventListener('input', set);
    set();
  });

  /* ---------- Product gallery ---------- */
  $$('[data-fk-gallery]').forEach((root) => {
    const track = $('[data-fk-gallery-track]', root);
    const thumbs = $$('[data-fk-thumb]', root);
    const counter = $('[data-fk-gallery-count]', root);
    if (!track) return;
    const slides = $$('[data-fk-slide]', track);
    const show = (index, smooth = true) => {
      const slide = slides[index];
      if (!slide) return;
      // The track is position: relative, so offsetLeft is measured from it
      track.scrollTo({ left: slide.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
    };
    thumbs.forEach((thumb) => thumb.addEventListener('click', () => show(Number(thumb.dataset.fkThumb))));
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const index = slides.indexOf(entry.target);
          thumbs.forEach((t, i) => t.setAttribute('aria-current', String(i === index)));
          if (counter) counter.textContent = `${index + 1} / ${slides.length}`;
        });
      },
      { root: track, threshold: 0.6 }
    );
    slides.forEach((s) => io.observe(s));
  });

  /* ---------- PIN code delivery estimate ---------- */
  if (!customElements.get('fk-delivery-check')) {
    class FkDeliveryCheck extends HTMLElement {
      connectedCallback() {
        this.input = $('[data-fk-pin]', this);
        this.result = $('[data-fk-pin-result]', this);
        this.zones = (this.dataset.zones || '')
          .split(';')
          .map((z) => {
            const [list, a, b] = z.split('|');
            return { prefixes: (list || '').split(',').map((p) => p.trim()).filter(Boolean), min: +a, max: +b };
          })
          .filter((z) => z.prefixes.length && z.min && z.max);
        $('form', this).addEventListener('submit', (e) => {
          e.preventDefault();
          this.check(true);
        });
        this.input.addEventListener('input', () => {
          this.input.value = this.input.value.replace(/\D/g, '').slice(0, 6);
          if (this.input.value.length === 6) this.check(true);
        });
        try {
          const saved = localStorage.getItem('fk-pin');
          if (saved && /^[1-9]\d{5}$/.test(saved)) {
            this.input.value = saved;
            this.check(false);
          }
        } catch (e) {
          /* storage unavailable */
        }
      }

      range(pin) {
        let best = null;
        let bestLen = 0;
        this.zones.forEach((z) =>
          z.prefixes.forEach((p) => {
            if (pin.startsWith(p) && p.length > bestLen) {
              best = z;
              bestLen = p.length;
            }
          })
        );
        return best ? [best.min, best.max] : [+this.dataset.min || 5, +this.dataset.max || 7];
      }

      fmt(days) {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
      }

      async check(user) {
        const pin = this.input.value.trim();
        if (!/^[1-9]\d{5}$/.test(pin)) {
          this.render(`<strong>Enter a valid 6-digit PIN code.</strong>`, 'error');
          return;
        }
        const [a, b] = this.range(pin);
        const line = `<strong>Delivery by ${this.fmt(a)} – ${this.fmt(b)}</strong>`;
        const extra = `<span>Dispatched within ${this.dataset.dispatch || '24 hours'} · Free delivery · Cash on delivery available</span>`;
        this.render(line + extra, 'ok');
        try {
          localStorage.setItem('fk-pin', pin);
        } catch (e) {
          /* storage unavailable */
        }
        if (user) track('delivery_check', { pin });
        // Optional place name from India Post; ignored if unavailable
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 3500);
          const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: ctrl.signal });
          clearTimeout(t);
          const data = await res.json();
          const entry = data && data[0];
          if (this.input.value.trim() !== pin || !entry) return;
          if (entry.Status === 'Error' || (entry.Status === 'Success' && !entry.PostOffice)) {
            this.render(`<strong>We couldn't find PIN ${pin}.</strong><span>Check the number, or message us on WhatsApp.</span>`, 'error');
          } else if (entry.Status === 'Success') {
            const po = entry.PostOffice[0];
            const place = [po.District, po.State].filter(Boolean).join(', ');
            if (place) this.render(line.replace('</strong>', ` to ${place}</strong>`) + extra, 'ok');
          }
        } catch (e) {
          /* lookup unavailable: keep the estimate */
        }
      }

      render(html, state) {
        this.result.innerHTML = html;
        this.result.dataset.state = state;
        this.result.hidden = false;
      }
    }
    customElements.define('fk-delivery-check', FkDeliveryCheck);
  }

  /* ---------- Size diagram: draw in when visible ---------- */
  const drawables = $$('[data-fk-draw]');
  if (drawables.length && 'IntersectionObserver' in window && !document.body.classList.contains('reduce-motion')) {
    const drawIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          drawIo.unobserve(entry.target);
          requestAnimationFrame(() => entry.target.setAttribute('data-fk-draw', 'on'));
        });
      },
      { threshold: 0.35 }
    );
    drawables.forEach((el) => {
      el.setAttribute('data-fk-draw', 'ready');
      drawIo.observe(el);
    });
  }

  /* ---------- Motion: scroll reveals and in-view video ---------- */
  const calm = document.body.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!calm && 'IntersectionObserver' in window) {
    const revealSel = [
      '.section-head', '.product-grid > li', '.tiles__grid > li', '.reels__track > li', '.imgtext__media',
      '.imgtext__grid > .stack', '.steps__item', '.icon-row__item', '.compare__scroll', '.sizes__grid > .stack',
      '.inspect__panel', '.faq__grid > *', '.signup__grid > *', '.fit-section__grid > *', '.story__grid > *',
      '.ig-feed__app', '.article-grid > li'
    ].join(',');
    const revealIo = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          revealIo.unobserve(entry.target);
          entry.target.classList.add('is-in');
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );
    const fold = window.innerHeight;
    $$(revealSel).forEach((el) => {
      if (el.closest('dialog, .drawer, .mega__panel')) return;
      if (el.getBoundingClientRect().top < fold * 0.9) return; // already on screen: leave it alone
      const siblings = Array.from(el.parentElement.children);
      const i = Math.min(siblings.indexOf(el), 6);
      el.style.setProperty('--fk-d', `${i * 70}ms`);
      el.setAttribute('data-fk-reveal', '');
      revealIo.observe(el);
    });
  }

  const autoVideos = $$('video[data-fk-autoplay]');
  if (autoVideos.length && 'IntersectionObserver' in window) {
    const vidIo = new IntersectionObserver(
      (entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          if (isIntersecting && !calm) {
            const p = target.play();
            if (p && p.catch) p.catch(() => {});
          } else {
            target.pause();
          }
        });
      },
      { threshold: 0.4 }
    );
    autoVideos.forEach((v) => {
      v.muted = true;
      if (calm) v.controls = true;
      vidIo.observe(v);
    });
  }

  /* ---------- Sticky add-to-cart bar ---------- */
  const sticky = $('[data-fk-sticky]');
  const mainAdd = $('[data-fk-main-add]');
  if (sticky && mainAdd) {
    document.body.classList.add('has-sticky-bar');
    const stickyBtn = $('[data-fk-sticky-add]', sticky);
    stickyBtn?.addEventListener('click', () => {
      if (mainAdd.tagName !== 'BUTTON' || mainAdd.disabled || mainAdd.getAttribute('aria-disabled') === 'true') {
        mainAdd.scrollIntoView({ behavior: 'smooth', block: 'center' });
        $('input:not([type="hidden"])', mainAdd)?.focus({ preventScroll: true });
        return;
      }
      mainAdd.click();
    });
    new IntersectionObserver(([entry]) => {
      const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      sticky.classList.toggle('is-visible', show);
      sticky.toggleAttribute('inert', !show);
    }).observe(mainAdd);
  }

  /* ---------- Header: sticky modes, blend-in, desktop dropdowns ---------- */
  let headerScroll = null;
  const initHeader = () => {
    const wrap = $('[data-fk-header]');
    if (!wrap) return;
    const mode = wrap.dataset.sticky;
    const overlay = wrap.classList.contains('header-wrapper--overlay');
    const megas = $$('[data-fk-mega]', wrap);

    if (headerScroll) window.removeEventListener('scroll', headerScroll);
    headerScroll = null;
    if (overlay || mode === 'scroll-up') {
      let lastY = window.scrollY;
      let ticking = false;
      const update = () => {
        const y = window.scrollY;
        if (overlay) wrap.classList.toggle('is-scrolled', y > 8);
        if (mode === 'scroll-up') {
          const busy = megas.some((d) => d.open);
          if (y < 120 || y < lastY - 4 || busy) wrap.classList.remove('is-hidden');
          else if (y > lastY + 4) wrap.classList.add('is-hidden');
        }
        lastY = y;
        ticking = false;
      };
      headerScroll = () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      };
      window.addEventListener('scroll', headerScroll, { passive: true });
      update();
    }

    const closeAll = (except) => megas.forEach((d) => d !== except && (d.open = false));
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    megas.forEach((d) => {
      const summary = $('summary', d);
      let timer;
      let hoverOpenedAt = 0;
      d.addEventListener('toggle', () => {
        if (d.open) {
          closeAll(d);
          track('menu_dropdown_open', { label: summary.textContent.trim() });
        }
      });
      if (canHover) {
        d.addEventListener('mouseenter', () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (!d.open) hoverOpenedAt = Date.now();
            d.open = true;
          }, 90);
        });
        d.addEventListener('mouseleave', () => {
          clearTimeout(timer);
          timer = setTimeout(() => (d.open = false), 200);
        });
        // A click right after hover-open should not close the panel again
        summary.addEventListener('click', (e) => {
          if (d.open && Date.now() - hoverOpenedAt < 600) e.preventDefault();
        });
      }
      d.addEventListener('focusout', (e) => {
        if (e.relatedTarget && !d.contains(e.relatedTarget)) d.open = false;
      });
    });
  };
  initHeader();
  document.addEventListener('shopify:section:load', initHeader);

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-fk-mega]')) return;
    $$('[data-fk-mega][open]').forEach((d) => (d.open = false));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = $('[data-fk-mega][open]');
    if (open) {
      open.open = false;
      $('summary', open).focus();
    }
  });

  /* ---------- Cart note (saved as you type) ---------- */
  let noteTimer;
  document.addEventListener('input', (event) => {
    const note = event.target.closest('[data-fk-cart-note]');
    if (!note) return;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      fetch(`${fk.routes.cartUpdate}.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ note: note.value }),
      }).catch(() => {});
    }, 400);
  });

  /* ---------- Fit checker ---------- */
  if (!customElements.get('fk-fit-check')) {
    class FkFitCheck extends HTMLElement {
      connectedCallback() {
        this.result = $('[data-fk-result]', this);
        this.wa = $('[data-fk-wa]', this);
        this.makeSelect = $('[data-fk-make]', this);
        this.modelSelect = $('[data-fk-model]', this);
        this.carText = $('[data-fk-car-text]', this);
        this.cars = [];
        const data = $('[data-fk-cars]', this);
        if (data) {
          try {
            this.cars = JSON.parse(data.textContent).filter((c) => c.make && c.model);
          } catch (e) {
            this.cars = [];
          }
        }
        if (this.makeSelect && this.modelSelect) {
          [...new Set(this.cars.map((c) => c.make))]
            .sort((a, b) => a.localeCompare(b))
            .forEach((make) => this.makeSelect.add(new Option(make, make)));
          this.makeSelect.addEventListener('change', () => this.onMake());
          this.modelSelect.addEventListener('change', () => this.onModel());
          this.restore();
        }
        if (this.carText) {
          this.carText.addEventListener('input', () => this.updateWhatsApp(this.carText.value.trim()));
        }
      }

      restore() {
        // Remember the shopper's car across pages
        let saved = null;
        try {
          saved = JSON.parse(localStorage.getItem('fk-car') || 'null');
        } catch (e) {
          saved = null;
        }
        if (!saved || !this.cars.some((c) => c.make === saved.make && c.model === saved.model)) return;
        this.makeSelect.value = saved.make;
        this.onMake(false);
        this.modelSelect.value = saved.model;
        this.onModel(false);
      }

      onMake(user = true) {
        const make = this.makeSelect.value;
        this.modelSelect.length = 1;
        this.cars
          .filter((c) => c.make === make)
          .map((c) => c.model)
          .sort((a, b) => a.localeCompare(b))
          .forEach((model) => this.modelSelect.add(new Option(model, model)));
        this.modelSelect.disabled = !make;
        this.show(null);
        this.updateWhatsApp(make);
        if (user && make) this.modelSelect.focus();
      }

      onModel(user = true) {
        const make = this.makeSelect.value;
        const model = this.modelSelect.value;
        const car = this.cars.find((c) => c.make === make && c.model === model);
        const name = model ? `${make} ${model}` : make;
        this.show(car ? { ...car, name } : null, user);
        this.updateWhatsApp(name);
        if (car) {
          try {
            localStorage.setItem('fk-car', JSON.stringify({ make, model }));
          } catch (e) {
            /* storage unavailable */
          }
        }
      }

      show(car, user = true) {
        if (!this.result) return;
        if (!car) {
          this.result.hidden = true;
          this.result.textContent = '';
          return;
        }
        const status = String(car.status || '').toLowerCase();
        let key = 'askText';
        if (status.startsWith('not')) key = 'noText';
        else if (status.includes('gap')) key = 'gapText';
        else if (status.startsWith('fit')) key = 'fitsText';
        const strong = document.createElement('strong');
        strong.textContent = (this.dataset[key] || '').replace('{car}', car.name);
        this.result.replaceChildren(strong);
        if (car.note) this.result.append(car.note);
        this.result.dataset.status = key;
        this.result.hidden = false;
        if (user) track('fit_check', { car: car.name, result: key });
      }

      updateWhatsApp(carName) {
        if (!this.wa || !this.dataset.waNumber) return;
        let message = this.dataset.waMessage || '';
        if (carName) message += ` My car: ${carName}.`;
        this.wa.href = `https://wa.me/${this.dataset.waNumber}?text=${encodeURIComponent(message)}`;
      }
    }
    customElements.define('fk-fit-check', FkFitCheck);
  }

  /* ---------- Back-in-stock / early-access forms: simple success state ---------- */
  $$('form[data-fk-signup]').forEach((form) => {
    if (new URLSearchParams(window.location.search).get('customer_posted') === 'true') {
      const ok = $('[data-fk-signup-success]', form.parentElement);
      if (ok) ok.hidden = false;
    }
  });
})();
