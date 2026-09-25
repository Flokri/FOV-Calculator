(function () {
	'use strict';

	var DEG = FOV.DEG;
	var CM_PER_INCH = FOV.CM_PER_INCH;
	var SVG_NS = 'http://www.w3.org/2000/svg';

	var $ = function (id) { return document.getElementById(id); };

	var state = {
		mode: 'fov',          // 'fov': distance -> FOV, 'distance': target -> distance
		unit: 'cm',
		screens: 3,
		ratio: '16_9',
		size: 32,
		distanceCm: 70,
		bezel: 8,
		curved: false,
		radius: 1000,
		targetGame: gameId('Triple Screen Angle'),
		target: 60
	};

	function gameId(name) {
		for (var i = 0; i < FOV.GAMES.length; i++) if (FOV.GAMES[i].name === name) return i;
		return 0;
	}

	// ---------- Formatting ----------

	function fmt(n, decimals) {
		return (Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals)).toFixed(decimals);
	}
	function toUnit(cm) { return state.unit === 'cm' ? cm : cm / CM_PER_INCH; }
	function fromUnit(v) { return state.unit === 'cm' ? v : v * CM_PER_INCH; }
	function lengthText(cm, decimals) {
		return fmt(toUnit(cm), decimals == null ? 1 : decimals) + ' ' + state.unit;
	}
	function lengthHtml(cm) {
		return fmt(toUnit(cm), 1) + '<small>' + state.unit + '</small>';
	}
	function degHtml(rad) { return fmt(rad * DEG, 1) + '<small>°</small>'; }

	// ---------- Target (reverse mode) ----------

	function targetRange(game) {
		var lim = FOV.limits(game);
		var min = lim.min, max = lim.max;
		if (min == null) min = 10;
		if (max == null) max = game.group === 'hfov' ? 180 * state.screens : 150;
		var step = game.step || Math.max(Math.pow(10, -game.decimals), game.group === 'hfovrad' ? 0.001 : 0.1);
		return { min: min, max: max, step: step, decimals: game.group === 'hfovrad' ? 3 : Math.max(0, Math.min(game.decimals, 2)) };
	}

	function fillTargetSelect() {
		var sel = $('target-game');
		var order = ['Triple Screen Angle', 'hFov', 'vFov'];
		var html = '<optgroup label="Angles">';
		order.forEach(function (name) {
			var g = FOV.GAMES[gameId(name)];
			var label = name === 'hFov' ? 'Horizontal FOV (all screens)' : name === 'vFov' ? 'Vertical FOV' : 'Side screen angle';
			html += '<option value="' + g.id + '">' + label + '</option>';
		});
		html += '</optgroup><optgroup label="Game setting">';
		FOV.GAMES.forEach(function (g) {
			if (order.indexOf(g.name) === -1) html += '<option value="' + g.id + '">' + g.name + '</option>';
		});
		sel.innerHTML = html + '</optgroup>';
	}

	function syncTargetInputs() {
		var game = FOV.GAMES[state.targetGame];
		var r = targetRange(game);
		state.target = Math.min(r.max, Math.max(r.min, state.target));
		['target', 'target-num'].forEach(function (id) {
			var el = $(id);
			el.min = r.min; el.max = r.max; el.step = r.step;
		});
		$('target').value = state.target;
		$('target-num').value = fmt(state.target, r.decimals);
		$('target-unit').textContent = game.unit || 'step';
		$('target-game').value = state.targetGame;
		var hints = {
			tangle: 'The angle between the centre screen and each side screen.',
			hfov: 'Horizontal field of view across all screens.',
			vfov: 'Vertical field of view, as most sims use it.'
		};
		var hint = hints[game.group] || 'Enter the value you want in the game and get the distance that makes it correct.';
		if (game.group === 'tangle' && state.screens === 1) hint = 'For a single screen this is its own horizontal FOV.';
		$('target-hint').textContent = hint;
	}

	// ---------- Main update ----------

	function params(distanceCm) {
		var parts = state.ratio.split('_');
		return {
			ratioX: parseFloat(parts[0]),
			ratioY: parseFloat(parts[1]),
			diagonalIn: state.size,
			distanceCm: distanceCm,
			screens: state.screens,
			bezelMm: state.bezel,
			curved: state.curved,
			radiusMm: state.radius
		};
	}

	function update() {
		var triple = state.screens > 1;
		var reverse = state.mode === 'distance';

		$('bezel-field').hidden = !triple;
		$('radius-field').hidden = !state.curved;
		$('distance-field').hidden = reverse;
		$('target-field').hidden = !reverse;
		$('stat-angle').hidden = !triple;
		document.querySelector('.headline').classList.toggle('single', !triple);
		$('stat-distance').classList.toggle('solved', reverse);

		var message = '';
		var distanceCm = state.distanceCm;
		if (reverse) {
			syncTargetInputs();
			var game = FOV.GAMES[state.targetGame];
			var res = FOV.solveDistance(game, state.target, params(state.distanceCm));
			if (res.error === 'too-wide') {
				message = 'This screen can’t cover that much at any distance. Lower the target or pick a bigger screen.';
			} else if (res.error === 'too-narrow') {
				message = 'That would put you more than 20 m away. Raise the target.';
			} else {
				distanceCm = res.distanceCm;
				if (distanceCm < 30) message = 'That puts your eyes very close to the screen. A larger screen gets the same view from further back.';
			}
			if (res.error) {
				renderEmpty(message);
				return;
			}
		}

		var p = params(distanceCm);
		var geo = FOV.geometry(p);
		var values = FOV.allValues(p);

		$('out-distance').innerHTML = lengthHtml(distanceCm);
		$('out-hfov').innerHTML = degHtml(geo.totalHAngle);
		$('out-vfov').innerHTML = degHtml(geo.vAngle);
		$('out-angle').innerHTML = degHtml(geo.hAngle);
		$('message').hidden = !message;
		$('message').textContent = message;

		renderGames(values, reverse ? state.targetGame : -1);
		var shape = renderTopView(p, geo);
		renderSideView(p, geo);
		renderFacts(p, geo, shape);
		state.lastDistanceCm = distanceCm;
		saveHash();
	}

	function renderEmpty(message) {
		['out-distance', 'out-hfov', 'out-vfov', 'out-angle'].forEach(function (id) { $(id).textContent = '–'; });
		$('message').hidden = false;
		$('message').textContent = message;
		$('games').innerHTML = '';
		$('top-view').innerHTML = '';
		$('side-view').innerHTML = '';
		$('facts').innerHTML = '';
		$('viz-note').textContent = '';
		state.lastDistanceCm = null;
	}

	function renderGames(values, targetId) {
		var html = '';
		var lastGroup = null;
		values.forEach(function (v) {
			var cls = [];
			if (lastGroup && v.game.group !== lastGroup) cls.push('group-start');
			if (v.game.id === targetId) cls.push('is-target');
			lastGroup = v.game.group;
			var name = v.game.name === 'Triple Screen Angle' ? 'Side screen angle' : v.game.name;
			var title = v.clamped ? ' title="Limited by the game (' + v.clamped + ')"' : '';
			html += '<tr class="' + cls.join(' ') + '"><td>' + name + '</td><td class="v' + (v.clamped ? ' clamped' : '') + '"' + title + '>' + v.text + '</td></tr>';
		});
		$('games').innerHTML = html;
	}

	// ---------- Top view ----------

	// World: centimetres, eye at the origin, looking along +y.
	function screenShape(p, geo) {
		var w = geo.width, d = p.distanceCm;
		var samples = p.curved ? 48 : 1;
		function at(t) {  // t: 0..w along the screen, left to right
			if (!p.curved) return [t - w / 2, d];
			var R = p.radiusMm / 10;
			var phi = (t - w / 2) / R;
			return [R * Math.sin(phi), d - R + R * Math.cos(phi)];
		}
		function pts(t0, t1) {
			var out = [];
			var n = Math.max(1, Math.round(samples * (t1 - t0) / w));
			for (var i = 0; i <= n; i++) out.push(at(t0 + (t1 - t0) * i / n));
			return out;
		}
		return { at: at, pts: pts };
	}

	function rotate(pt, a) { // clockwise, seen from above
		var c = Math.cos(a), s = Math.sin(a);
		return [pt[0] * c + pt[1] * s, -pt[0] * s + pt[1] * c];
	}

	function el(name, attrs, text) {
		var e = document.createElementNS(SVG_NS, name);
		for (var k in attrs) e.setAttribute(k, attrs[k]);
		if (text != null) e.textContent = text;
		return e;
	}

	function polar(cx, cy, r, a) { // a: radians clockwise from "up" on screen
		return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
	}
	function arcPath(cx, cy, r, a0, a1) {
		var s = polar(cx, cy, r, a0), e = polar(cx, cy, r, a1);
		var large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
		return 'M' + s[0] + ' ' + s[1] + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + e[0] + ' ' + e[1];
	}

	function renderTopView(p, geo) {
		var svg = $('top-view');
		svg.innerHTML = '';
		var shape = screenShape(p, geo);
		var w = geo.width, bz = geo.bezelCm / 2;
		var rotations = p.screens > 1 ? [-geo.hAngle, 0, geo.hAngle] : [0];

		var screens = rotations.map(function (a) {
			function tr(list) { return list.map(function (q) { return rotate(q, a); }); }
			return {
				all: tr(shape.pts(0, w)),
				panel: tr(shape.pts(bz, w - bz)),
				bezels: bz > 0 ? [tr(shape.pts(0, bz)), tr(shape.pts(w - bz, w))] : []
			};
		});

		// Bounds in world units, including the head.
		var xs = [-12, 12], ys = [-16, 8];
		screens.forEach(function (s) { s.all.forEach(function (q) { xs.push(q[0]); ys.push(q[1]); }); });
		var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
		var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
		var worldW = maxX - minX, worldH = maxY - minY;

		// Draw at the element's real width so labels keep their size on phones.
		var VW = Math.max(300, Math.round(svg.getBoundingClientRect().width) || 800);
		var pad = VW < 500 ? 40 : 56;
		var scale = Math.min((VW - 2 * pad) / worldW, (VW < 500 ? 300 : 400) / worldH);
		var VH = Math.round(worldH * scale + 2 * pad);
		var ox = VW / 2 - (minX + maxX) / 2 * scale;
		var oy = pad + maxY * scale;
		function P(q) { return [ox + q[0] * scale, oy - q[1] * scale]; }
		function pointsAttr(list) { return list.map(function (q) { var s = P(q); return s[0].toFixed(1) + ',' + s[1].toFixed(1); }).join(' '); }

		svg.setAttribute('viewBox', '0 0 ' + VW + ' ' + VH);
		var eye = P([0, 0]);

		// Field of view wedges.
		screens.forEach(function (s) {
			svg.appendChild(el('polygon', { points: pointsAttr([[0, 0]].concat(s.all)), fill: 'var(--fov-fill)', stroke: 'none' }));
		});
		var outer = [screens[0].all[0], screens[screens.length - 1].all[screens[screens.length - 1].all.length - 1]];
		outer.forEach(function (q) {
			var s = P(q);
			svg.appendChild(el('line', { x1: eye[0], y1: eye[1], x2: s[0], y2: s[1], stroke: 'var(--fov)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
		});

		// Screens and bezels.
		screens.forEach(function (s) {
			svg.appendChild(el('polyline', { points: pointsAttr(s.panel), fill: 'none', stroke: 'var(--screen)', 'stroke-width': 6, 'stroke-linecap': 'butt' }));
			s.bezels.forEach(function (b) {
				svg.appendChild(el('polyline', { points: pointsAttr(b), fill: 'none', stroke: 'var(--bezel)', 'stroke-width': 6 }));
			});
		});

		// Distance to the centre screen.
		var mid = P([0, p.distanceCm]);
		svg.appendChild(el('line', { x1: eye[0], y1: eye[1] - 14, x2: mid[0], y2: mid[1] + 6, stroke: 'var(--ink-3)', 'stroke-width': 1 }));
		svg.appendChild(el('text', { x: eye[0] + 8, y: (eye[1] + mid[1]) / 2 + 12, class: 'svg-label-strong svg-halo' }, lengthText(p.distanceCm)));

		// Total horizontal FOV arc at the eye.
		var H = geo.totalHAngle;
		var arcR = Math.min(70, (eye[1] - mid[1]) * 0.45);
		svg.appendChild(el('path', { d: arcPath(eye[0], eye[1], arcR, -H / 2, H / 2), fill: 'none', stroke: 'var(--fov)', 'stroke-width': 2 }));
		var lab = polar(eye[0], eye[1], arcR + 14, 0);
		svg.appendChild(el('text', { x: eye[0] - 8, y: lab[1] + 4, 'text-anchor': 'end', class: 'svg-fov-label svg-halo' }, fmt(H * DEG, 1) + '°'));

		// Side screen angle at the right-hand joint.
		if (p.screens > 1) {
			var J = P(rotate(shape.at(w), 0));
			var jr = 34;
			var a0 = Math.PI / 2, a1 = Math.PI / 2 + geo.hAngle;
			var ext = polar(J[0], J[1], jr + 12, a0);
			svg.appendChild(el('line', { x1: J[0], y1: J[1], x2: ext[0], y2: ext[1], stroke: 'var(--ink-3)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
			svg.appendChild(el('path', { d: arcPath(J[0], J[1], jr, a0, a1), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2 }));
			var la = polar(J[0], J[1], jr + 10, (a0 + a1) / 2);
			svg.appendChild(el('text', { x: la[0] + 4, y: la[1] + 4, class: 'svg-label-strong svg-halo', fill: 'var(--accent)', style: 'fill: var(--accent)' }, fmt(geo.hAngle * DEG, 1) + '°'));
		}

		// Head.
		var hc = P([0, -7]);
		svg.appendChild(el('ellipse', { cx: hc[0], cy: hc[1], rx: 8 * scale, ry: 10 * scale, fill: 'var(--surface)', stroke: 'var(--ink-2)', 'stroke-width': 1.5 }));
		svg.appendChild(el('circle', { cx: eye[0], cy: eye[1], r: 3.5, fill: 'var(--fov)' }));

		// Scale bar.
		var barCm = niceBar(worldW);
		var bx = 16, by = VH - 16;
		svg.appendChild(el('line', { x1: bx, y1: by, x2: bx + barCm * scale, y2: by, stroke: 'var(--ink-2)', 'stroke-width': 2 }));
		svg.appendChild(el('line', { x1: bx, y1: by - 5, x2: bx, y2: by + 1, stroke: 'var(--ink-2)', 'stroke-width': 2 }));
		svg.appendChild(el('line', { x1: bx + barCm * scale, y1: by - 5, x2: bx + barCm * scale, y2: by + 1, stroke: 'var(--ink-2)', 'stroke-width': 2 }));
		svg.appendChild(el('text', { x: bx, y: by - 9, class: 'svg-label' }, state.unit === 'cm' ? barCm + ' cm' : fmt(barCm / CM_PER_INCH, 0) + ' in'));

		$('viz-note').textContent = p.screens > 1
			? 'Side screens angled ' + fmt(geo.hAngle * DEG, 1) + '° so each one faces your eyes'
			: 'Single screen, ' + fmt(geo.hAngle * DEG, 1) + '° wide';

		var sx = xs.slice(2), sy = ys.slice(2);
		return { width: Math.max.apply(null, sx) - Math.min.apply(null, sx), depth: Math.max.apply(null, sy) - Math.min.apply(null, sy) };
	}

	function niceBar(worldW) {
		var unitCm = state.unit === 'cm' ? 1 : CM_PER_INCH;
		var target = worldW / 5 / unitCm;
		var steps = [5, 10, 20, 25, 50, 100];
		var v = steps[0];
		steps.forEach(function (s) { if (s <= target) v = s; });
		return v * unitCm;
	}

	// ---------- Side view ----------

	function renderSideView(p, geo) {
		var svg = $('side-view');
		svg.innerHTML = '';
		var VW = Math.max(300, Math.round(svg.getBoundingClientRect().width) || 420), VH = 190, left = 70, right = 64;
		var d = p.distanceCm, h = geo.panelHeight;
		var halfV = Math.tan(geo.vAngle / 2) * d;
		var scale = Math.min((VW - left - right) / d, (VH - 50) / Math.max(h, 2 * halfV));
		var cy = VH / 2 - 6;
		var ex = left, sx = left + d * scale;
		svg.setAttribute('viewBox', '0 0 ' + VW + ' ' + VH);

		svg.appendChild(el('polygon', { points: [ex, cy, sx, cy - halfV * scale, sx, cy + halfV * scale].join(' '), fill: 'var(--fov-fill)' }));
		[-1, 1].forEach(function (sgn) {
			svg.appendChild(el('line', { x1: ex, y1: cy, x2: sx, y2: cy + sgn * halfV * scale, stroke: 'var(--fov)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
		});
		svg.appendChild(el('line', { x1: sx, y1: cy - h / 2 * scale, x2: sx, y2: cy + h / 2 * scale, stroke: 'var(--screen)', 'stroke-width': 6 }));
		svg.appendChild(el('ellipse', { cx: ex - 6 * scale, cy: cy - 2 * scale, rx: 10 * scale, ry: 12 * scale, fill: 'var(--surface)', stroke: 'var(--ink-2)', 'stroke-width': 1.5 }));
		svg.appendChild(el('circle', { cx: ex, cy: cy, r: 3.5, fill: 'var(--fov)' }));

		var ar = Math.min(46, d * scale * 0.4);
		var va = geo.vAngle;
		svg.appendChild(el('path', { d: arcPath(ex, cy, ar, Math.PI / 2 - va / 2, Math.PI / 2 + va / 2), fill: 'none', stroke: 'var(--fov)', 'stroke-width': 2 }));
		svg.appendChild(el('text', { x: ex + ar + 8, y: cy + 4, class: 'svg-fov-label svg-halo' }, fmt(va * DEG, 1) + '°'));
		svg.appendChild(el('text', { x: sx + 10, y: cy + 4, class: 'svg-label' }, lengthText(h, 0)));
		svg.appendChild(el('line', { x1: ex, y1: VH - 18, x2: sx, y2: VH - 18, stroke: 'var(--ink-3)', 'stroke-width': 1 }));
		svg.appendChild(el('text', { x: (ex + sx) / 2, y: VH - 24, 'text-anchor': 'middle', class: 'svg-label' }, lengthText(d)));
	}

	function renderFacts(p, geo, shape) {
		var rows = [
			['Panel size', fmt(toUnit(geo.panelWidth), 1) + ' × ' + lengthText(geo.panelHeight)],
			[p.screens > 1 ? 'Rig width' : 'Screen width', lengthText(shape.width)],
		];
		if (shape.depth > 0.5) rows.push(['Rig depth', lengthText(shape.depth)]);
		if (p.screens > 1) rows.push(['Side screen angle', fmt(geo.hAngle * DEG, 1) + '°']);
		if (p.curved) rows.push(['Curve depth', lengthText(geo.sagitta)]);
		rows.push(['FOV per screen', fmt(geo.hAngle * DEG, 1) + '°']);
		$('facts').innerHTML = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('');
	}

	// ---------- Inputs ----------

	function bindPair(rangeId, numId, key, decimals, toState, fromState) {
		toState = toState || function (v) { return v; };
		fromState = fromState || function (v) { return v; };
		function sync() {
			$(rangeId).value = fromState(state[key]);
			$(numId).value = fmt(fromState(state[key]), decimals);
		}
		$(rangeId).addEventListener('input', function () {
			state[key] = toState(parseFloat(this.value));
			$(numId).value = fmt(fromState(state[key]), decimals);
			update();
		});
		$(numId).addEventListener('input', function () {
			var v = parseFloat(this.value);
			if (!isFinite(v) || v <= 0 && key !== 'bezel') return;
			state[key] = toState(v);
			$(rangeId).value = fromState(state[key]);
			update();
		});
		$(numId).addEventListener('change', sync);
		return sync;
	}

	var syncers = [];

	function syncAll() {
		document.querySelector('input[name="mode"][value="' + state.mode + '"]').checked = true;
		document.querySelector('input[name="unit"][value="' + state.unit + '"]').checked = true;
		document.querySelector('input[name="screens"][value="' + state.screens + '"]').checked = true;
		$('ratio').value = state.ratio;
		$('curved').checked = state.curved;
		var dr = $('distance');
		dr.min = state.unit === 'cm' ? 20 : 8;
		dr.max = state.unit === 'cm' ? 250 : 100;
		document.querySelectorAll('.unit-label').forEach(function (e) { e.textContent = state.unit; });
		syncers.forEach(function (s) { s(); });
	}

	function init() {
		fillTargetSelect();
		loadHash();

		syncers.push(bindPair('size', 'size-num', 'size', 1));
		syncers.push(bindPair('distance', 'distance-num', 'distanceCm', 1, fromUnit, toUnit));
		syncers.push(bindPair('bezel', 'bezel-num', 'bezel', 0));
		syncers.push(bindPair('radius', 'radius-num', 'radius', 0));

		$('target').addEventListener('input', function () { state.target = parseFloat(this.value); update(); });
		$('target-num').addEventListener('input', function () {
			var v = parseFloat(this.value);
			if (!isFinite(v)) return;
			state.target = v;
			$('target').value = v;
			update();
		});
		$('target-num').addEventListener('change', function () { update(); });
		$('target-game').addEventListener('change', function () {
			// Start from what the current setup already gives, so the distance doesn't jump.
			state.targetGame = parseInt(this.value, 10);
			state.target = currentValue(state.targetGame);
			update();
		});

		document.querySelectorAll('input[name="mode"]').forEach(function (r) {
			r.addEventListener('change', function () {
				if (state.lastDistanceCm) state.distanceCm = state.lastDistanceCm;
				state.mode = this.value;
				if (state.mode === 'distance') state.target = currentValue(state.targetGame);
				syncAll();
				update();
			});
		});
		document.querySelectorAll('input[name="unit"]').forEach(function (r) {
			r.addEventListener('change', function () { state.unit = this.value; syncAll(); update(); });
		});
		document.querySelectorAll('input[name="screens"]').forEach(function (r) {
			r.addEventListener('change', function () {
				state.screens = parseInt(this.value, 10);
				if (state.screens === 1 && FOV.GAMES[state.targetGame].group === 'tangle') {
					state.targetGame = gameId('hFov');
					state.target = currentValue(state.targetGame);
				}
				update();
			});
		});
		$('ratio').addEventListener('change', function () { state.ratio = this.value; update(); });
		$('curved').addEventListener('change', function () { state.curved = this.checked; update(); });

		$('copy-link').addEventListener('click', function () {
			var btn = this;
			function done(text) { btn.textContent = text; setTimeout(function () { btn.textContent = 'Copy link to this setup'; }, 1800); }
			try {
				navigator.clipboard.writeText(location.href).then(function () { done('Link copied'); }, function () { done('Copy the address bar instead'); });
			} catch (e) { done('Copy the address bar instead'); }
		});

		syncAll();
		update();
	}

	function currentValue(id) {
		var d = state.lastDistanceCm || state.distanceCm;
		var p = params(d);
		var game = FOV.GAMES[id];
		var r = targetRange(game);
		var v = FOV.rawValue(game, FOV.geometry(p), p);
		return parseFloat(fmt(Math.min(r.max, Math.max(r.min, v)), r.decimals));
	}

	// ---------- Shareable link ----------

	var KEYS = { mode: 'm', unit: 'u', screens: 's', ratio: 'r', size: 'd', distanceCm: 'dist', bezel: 'b', curved: 'c', radius: 'rad', targetGame: 'tg', target: 't' };

	function saveHash() {
		var parts = [];
		for (var k in KEYS) {
			var v = state[k];
			if (typeof v === 'boolean') v = v ? 1 : 0;
			if (typeof v === 'number') v = parseFloat(v.toFixed(3));
			parts.push(KEYS[k] + '=' + encodeURIComponent(v));
		}
		try { history.replaceState(null, '', '#' + parts.join('&')); } catch (e) { /* not allowed in some embeds */ }
	}

	function loadHash() {
		var hash;
		try { hash = location.hash.slice(1); } catch (e) { return; }
		if (!hash || hash.indexOf('=') === -1) return;
		var map = {};
		hash.split('&').forEach(function (kv) {
			var i = kv.indexOf('=');
			if (i > 0) map[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
		});
		for (var k in KEYS) {
			if (!(KEYS[k] in map)) continue;
			var raw = map[KEYS[k]];
			if (typeof state[k] === 'number') { var n = parseFloat(raw); if (isFinite(n)) state[k] = n; }
			else if (typeof state[k] === 'boolean') state[k] = raw === '1';
			else state[k] = raw;
		}
		if (['fov', 'distance'].indexOf(state.mode) === -1) state.mode = 'fov';
		if (['cm', 'in'].indexOf(state.unit) === -1) state.unit = 'cm';
		if (state.screens !== 1) state.screens = 3;
		if (!document.querySelector('#ratio option[value="' + state.ratio + '"]')) state.ratio = '16_9';
		if (!FOV.GAMES[state.targetGame]) state.targetGame = gameId('Triple Screen Angle');
	}

	var resizeTimer;
	window.addEventListener('resize', function () {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(update, 120);
	});

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
	else init();
})();
