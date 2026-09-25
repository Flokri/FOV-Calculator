/*
 * FOV math, shared by the forward (distance -> FOV) and reverse (FOV -> distance) modes.
 *
 * The forward formulas are unchanged from the original calculator by Markus Ewert and
 * contributors (https://github.com/dinex86/FOV-Calculator). The reverse mode inverts them
 * numerically so it stays exact for curved screens and every per-game conversion.
 */
(function (root) {
	'use strict';

	var DEG = 180 / Math.PI;
	var CM_PER_INCH = 2.54;

	// Kept in the same order as the original calculator.
	var GAME_GROUPS = {
		'hfov': {
			"hFov": { decimals: 0, factor: 1 },
			"Project CARS 1/2": { min: 35, max: 180, decimals: 0, factor: 1 },
			"European & American Truck Simulator": { min: 35, max: 180, decimals: 0, factor: 1 },
			"RaceRoom Racing Experience": { min: 35, max: 180, decimals: 1, factor: 1 }
		},
		'hfovrad': {
			"Richard Burns Rally": { min: 10, max: 180, decimals: 6, factor: 1 }
		},
		'hfov_base_step': {
			// https://www.reddit.com/r/F1Game/comments/7x0of9/codemasters_f1_20162017_fov_slider/
			"F1 2016-2018": { min: -1, max: 1, decimals: 2, factor: 1, base: 77, increment: 2, step: 0.05 },
			"F1 2019-2020": { min: -10, max: 10, decimals: 1, factor: 1, base: 77, increment: 2, step: 0.1 },
			"F1 2021+": { min: -20, max: 20, decimals: 0, factor: 1, base: 77, increment: 2, step: 1 }
		},
		'vfov': {
			"vFov": { decimals: 0, factor: 1 },
			"Assetto Corsa, Assetto Corsa Competizione": { min: 10, max: 120, decimals: 1, factor: 1 },
			"rFactor 1 & 2, GSC, GSCE, SCE, AMS (ISI Engine)": { min: 10, max: 100, decimals: 0, factor: 1 },
			"DiRT Rally 1/2, GRID Autosport": { min: 10, max: 115, decimals: 0, factor: 2 }
		},
		'vfovx': {
			"GTR2": { min: 0.5, max: 1.5, decimals: 1, factor: 1, baseSingle: 58, baseTriple: 58 },
			"Race07": { min: 0.4, max: 1.5, decimals: 1, factor: 1, baseSingle: 58, baseTriple: 58 }
		},
		'vfov_base_step': {
			// https://answers.ea.com/t5/General-Discussion/FOV-calculator/m-p/13185341/highlight/true#M1444
			"EA WRC": { min: 0, max: 100, decimals: 0, factor: 1, base: 18, increment: 0.5, step: 1 }
		},
		'tangle': {
			"Triple Screen Angle": { min: 10, max: 180, decimals: 2, factor: 1 }
		}
	};

	var GAMES = [];
	Object.keys(GAME_GROUPS).forEach(function (group) {
		Object.keys(GAME_GROUPS[group]).forEach(function (name) {
			var g = Object.assign({ id: GAMES.length, name: name, group: group }, GAME_GROUPS[group][name]);
			g.unit = group === 'hfovrad' ? 'rad'
				: group === 'vfovx' ? 'x'
				: (group === 'hfov_base_step' || group === 'vfov_base_step') ? ''
				: '°';
			GAMES.push(g);
		});
	});

	function triangularAngle(baseCm, distanceCm) {
		return Math.atan2(baseCm / 2, distanceCm) * 2;
	}

	// See the original script for the derivation: the screen is an arc of radius r, d is the
	// distance to the middle of the screen, b the sagitta and 2c the chord between the edges.
	function curvedAngle(baseCm, radiusMm, distanceCm) {
		var r = radiusMm / 10;
		var arc = baseCm / r;
		var b = r * (1 - Math.cos(arc / 2));
		var c = Math.sqrt((2 * r * b) - (b * b));
		return 2 * Math.atan2(c, distanceCm - b);
	}

	/*
	 * p: { ratioX, ratioY, diagonalIn, distanceCm, screens, bezelMm, curved, radiusMm }
	 * All lengths returned are in cm, all angles in radians.
	 */
	function geometry(p) {
		var diag = p.diagonalIn * CM_PER_INCH;
		var k = Math.sqrt((diag * diag) / (p.ratioX * p.ratioX + p.ratioY * p.ratioY));
		var panelWidth = p.ratioX * k;
		var panelHeight = p.ratioY * k;
		// Bezel is given per screen edge; two edges add up between neighbouring panels.
		var bezelCm = p.screens > 1 ? p.bezelMm / 10 * 2 : 0;
		var width = panelWidth + bezelCm;
		var hAngle = p.curved
			? curvedAngle(width, p.radiusMm, p.distanceCm)
			: triangularAngle(width, p.distanceCm);
		var vAngle = 2 * Math.atan2(Math.tan(hAngle / 2) * p.ratioY, p.ratioX);
		var r = p.radiusMm / 10;
		return {
			panelWidth: panelWidth,
			panelHeight: panelHeight,
			bezelCm: bezelCm,
			width: width,
			hAngle: hAngle,
			vAngle: vAngle,
			totalHAngle: hAngle * p.screens,
			sagitta: p.curved ? r * (1 - Math.cos(width / r / 2)) : 0
		};
	}

	/*
	 * The game value before rounding and before the game's min/max limits, in the game's own
	 * unit. Monotonic in distance, which is what makes the reverse mode's bisection work.
	 */
	function rawValue(game, geo, p) {
		var value;
		switch (game.group) {
			case 'hfov':
			case 'hfov_base_step':
				value = DEG * geo.hAngle * p.screens; break;
			case 'vfov':
			case 'vfovx':
			case 'vfov_base_step':
				value = DEG * geo.vAngle; break;
			case 'hfovrad':
				value = DEG * triangularAngle(geo.width / p.ratioX * p.ratioY / 3 * 4, p.distanceCm); break;
			case 'tangle':
				value = DEG * geo.hAngle; break;
		}
		value *= game.factor;
		if (game.group === 'vfovx') {
			value /= (p.screens === 1 ? game.baseSingle : game.baseTriple);
		}
		if (game.group === 'hfov_base_step' || game.group === 'vfov_base_step') {
			value = (value - game.base) / game.increment * game.step;
		}
		if (game.group === 'hfovrad') {
			value /= DEG;
		}
		return value;
	}

	// Limits in the game's own unit (Richard Burns Rally's are stored in degrees).
	function limits(game) {
		var s = game.group === 'hfovrad' ? 1 / DEG : 1;
		return {
			min: game.min != null ? game.min * s : null,
			max: game.max != null ? game.max * s : null
		};
	}

	// Same output as the original calculator, plus a flag when the game's limits kicked in.
	function displayValue(game, raw) {
		var value = raw;
		if (game.group === 'hfov_base_step' || game.group === 'vfov_base_step') {
			value = Math.round(raw / game.step) * game.step;
		}
		var lim = limits(game);
		var clamped = false;
		if (lim.min != null && value < lim.min) { value = lim.min; clamped = 'min'; }
		if (lim.max != null && value > lim.max) { value = lim.max; clamped = 'max'; }
		var base = Math.pow(10, game.decimals);
		return {
			value: value,
			text: (Math.round(value * base) / base).toFixed(game.decimals) + game.unit,
			clamped: clamped
		};
	}

	function allValues(p) {
		var geo = geometry(p);
		return GAMES.map(function (game) {
			var raw = rawValue(game, geo, p);
			return Object.assign({ game: game, raw: raw }, displayValue(game, raw));
		});
	}

	var MIN_DISTANCE_CM = 1;
	var MAX_DISTANCE_CM = 2000;

	/*
	 * Reverse mode: the seating distance (cm) at which `game` reads `target`.
	 * Returns { distanceCm } or { error: 'too-wide' | 'too-narrow' }.
	 */
	function solveDistance(game, target, p) {
		function f(d) {
			var q = Object.assign({}, p, { distanceCm: d });
			return rawValue(game, geometry(q), q);
		}
		// A curved screen has to stay in front of the eye, or the angle wraps past 180°.
		var lo = MIN_DISTANCE_CM, hi = MAX_DISTANCE_CM;
		if (p.curved) lo = Math.max(lo, geometry(Object.assign({}, p, { distanceCm: hi })).sagitta + 0.5);
		// Every value decreases as you sit further away.
		if (target > f(lo)) return { error: 'too-wide' };
		if (target < f(hi)) return { error: 'too-narrow' };
		for (var i = 0; i < 80; i++) {
			var mid = (lo + hi) / 2;
			if (f(mid) > target) lo = mid; else hi = mid;
		}
		return { distanceCm: (lo + hi) / 2 };
	}

	root.FOV = {
		DEG: DEG,
		CM_PER_INCH: CM_PER_INCH,
		GAMES: GAMES,
		geometry: geometry,
		rawValue: rawValue,
		displayValue: displayValue,
		limits: limits,
		allValues: allValues,
		solveDistance: solveDistance
	};
	if (typeof module !== 'undefined') module.exports = root.FOV;
})(typeof window !== 'undefined' ? window : globalThis);
