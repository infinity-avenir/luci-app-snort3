'use strict';
'require view';
'require rpc';
'require ui';
'require poll';
'require dom';

var callRulesInfo = rpc.declare({
	object: 'luci.snort3', method: 'getRulesInfo', expect: { }
});
var callListRules = rpc.declare({
	object: 'luci.snort3', method: 'listRules', expect: { }
});
var callStartUpdate = rpc.declare({
	object: 'luci.snort3', method: 'startUpdate', expect: { }
});
var callUpdateStatus = rpc.declare({
	object: 'luci.snort3', method: 'getUpdateStatus', expect: { }
});
var callSetOinkcode = rpc.declare({
	object: 'luci.snort3', method: 'setOinkcode', params: [ 'oinkcode' ], expect: { }
});
var callLinkRules = rpc.declare({
	object: 'luci.snort3', method: 'linkRules', params: [ 'target' ], expect: { }
});
var callGetSchedule = rpc.declare({
	object: 'luci.snort3', method: 'getSchedule', expect: { }
});
var callSetSchedule = rpc.declare({
	object: 'luci.snort3', method: 'setSchedule',
	params: [ 'frequency', 'day', 'hour', 'minute' ],
	expect: { }
});

function fmtBytes(b) {
	b = b || 0;
	if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MiB';
	if (b >= 1024) return (b / 1024).toFixed(1) + ' KiB';
	return b + ' B';
}

function infoCard(title, value, sub, small) {
	return E('div', { 'class': 's3-card' }, [
		E('h4', {}, title),
		E('div', { 'class': 's3-metric', 'style': small ? 'font-size:1rem;font-weight:600' : '' }, String(value)),
		sub ? E('div', { 'class': 's3-sub' }, sub) : ''
	]);
}

function renderInfo(info) {
	info = info || {};
	var date = info.last_update
		? new Date(info.last_update * 1000).toLocaleString()
		: _('never');
	var source = info.oinkcode_set
		? _('Subscription')
		: _('Community (free)');
	return [
		infoCard(_('Installed rules'), info.rule_count || 0, _('signatures across all rule files')),
		infoCard(_('Last updated'), date, '', true),
		infoCard(_('Snort version'), info.snort_version || _('unknown'), info.snapshot_name || '', true),
		infoCard(_('Active source'), source, info.oinkcode_set ? info.snapshot_name : _('no oinkcode set'), true)
	];
}

/* Day-of-week labels for the weekly schedule dropdown */
var WEEKDAYS = [
	{ val: '0', label: 'Sunday' },
	{ val: '1', label: 'Monday' },
	{ val: '2', label: 'Tuesday' },
	{ val: '3', label: 'Wednesday' },
	{ val: '4', label: 'Thursday' },
	{ val: '5', label: 'Friday' },
	{ val: '6', label: 'Saturday' }
];

return view.extend({
	load: function() {
		return Promise.all([
			callRulesInfo().catch(function() { return {}; }),
			callListRules().catch(function() { return {}; }),
			callUpdateStatus().catch(function() { return {}; }),
			callGetSchedule().catch(function() { return {}; })
		]);
	},

	ruleFileOptions: function(names, active) {
		names = (names || [])
			.filter(function(n) { return /\.rules$/.test(n) && n !== 'active.rules'; })
			.sort();
		var opts = names.map(function(n) {
			return E('option', { 'value': n, 'selected': (n === active) ? '' : null }, n);
		});
		if (!opts.length)
			opts = [ E('option', { 'value': '' }, _('No rule files installed yet')) ];
		return opts;
	},

	applyStatus: function(st) {
		st = st || {};
		var pct = parseInt(st.percent, 10);
		if (isNaN(pct)) pct = 0;
		pct = Math.max(0, Math.min(100, pct));

		this.progWrap.style.display = '';
		this.progBar.style.width = pct + '%';
		this.progLabel.textContent =
			(st.phase ? '[' + st.phase + '] ' : '') + (st.message || '') + ' — ' + pct + '%';

		var logText = (st.log || '').replace(/\s+$/, '');
		dom.content(this.progLog, logText
			? logText.split('\n').map(function(l) { return E('div', { 'class': 's3-row' }, l); })
			: E('div', { 'class': 's3-empty' }, _('No output yet.')));

		var running = !!st.running;
		this.updateBtn.disabled = running;
		return running;
	},

	startStatusPoll: function() {
		if (this._pollFn) return;
		this._pollFn = L.bind(function() {
			return callUpdateStatus().then(L.bind(function(st) {
				var running = this.applyStatus(st);
				if (!running) {
					poll.remove(this._pollFn);
					this._pollFn = null;
					if (st.success)
						ui.addNotification(null, E('p', _('Rule update finished: %s').format(st.message || '')), 'info');
					else if (st.phase === 'error')
						ui.addNotification(null, E('p', _('Rule update failed: %s').format(st.message || '')), 'danger');
					this.refreshInfo();
				}
			}, this));
		}, this);
		poll.add(this._pollFn, 2);
		poll.start();
	},

	refreshInfo: function() {
		return Promise.all([ callRulesInfo(), callListRules() ]).then(L.bind(function(r) {
			var info = r[0] || {};
			var list = r[1] || {};
			this.rulesDir = info.rules_dir || this.rulesDir;
			dom.content(this.infoHost, renderInfo(info));
			dom.content(this.fileSelect, this.ruleFileOptions(list.files, list.active));
		}, this));
	},

	handleUpdate: function() {
		return callStartUpdate().then(L.bind(function(res) {
			if (res && res.started) {
				this.applyStatus({ running: true, phase: 'queued', percent: 0, message: _('Starting…'), log: '' });
				this.startStatusPoll();
			} else {
				ui.addNotification(null, E('p', (res && res.message) || _('Could not start the update.')), 'warning');
			}
		}, this));
	},

	handleSaveOink: function() {
		var v = (this.oinkInput.value || '').trim();
		if (!v) {
			ui.addNotification(null, E('p', _('Enter an oinkcode, or use "Use community rules" to clear it.')), 'warning');
			return Promise.resolve();
		}
		return callSetOinkcode(v).then(L.bind(function(res) {
			if (res && res.success) {
				if (res.oinkcode != null)
					this.oinkInput.value = res.oinkcode;
				ui.addNotification(null, E('p', _('Oinkcode saved. Subscription rules will be used on the next update.')), 'info');
			} else {
				ui.addNotification(null, E('p', _('Failed to save the oinkcode.')), 'danger');
			}
			return this.refreshInfo();
		}, this));
	},

	handleClearOink: function() {
		return callSetOinkcode('').then(L.bind(function(res) {
			if (res && res.success) {
				this.oinkInput.value = '';
				ui.addNotification(null, E('p', _('Oinkcode cleared. The free community ruleset will be used.')), 'info');
			}
			return this.refreshInfo();
		}, this));
	},

	handleLink: function() {
		var target = this.fileSelect.value || '';
		if (!target) {
			ui.addNotification(null, E('p', _('No rule file selected.')), 'warning');
			return Promise.resolve();
		}
		return callLinkRules(target).then(L.bind(function(res) {
			if (res && res.success)
				ui.addNotification(null, E('p', _('active.rules now points to %s.').format(target)), 'info');
			else
				ui.addNotification(null, E('p', _('Could not update the symlink.')), 'danger');
			return this.refreshInfo();
		}, this));
	},

	/* ---------- schedule helpers ---------- */

	updateScheduleVisibility: function() {
		var freq = this.schedFreq.value;
		this.schedDayRow.style.display = (freq === 'monthly' || freq === 'weekly') ? '' : 'none';
		this.schedTimeRow.style.display = (freq !== 'disabled') ? '' : 'none';

		/* Swap the day dropdown content based on frequency */
		if (freq === 'monthly') {
			dom.content(this.schedDay, this.monthDayOpts());
		} else if (freq === 'weekly') {
			dom.content(this.schedDay, this.weekDayOpts());
		}
	},

	monthDayOpts: function() {
		var opts = [];
		for (var d = 1; d <= 30; d++) {
			opts.push(E('option', { 'value': String(d) }, String(d)));
		}
		return opts;
	},

	weekDayOpts: function() {
		return WEEKDAYS.map(function(w) {
			return E('option', { 'value': w.val }, _(w.label));
		});
	},

	hourOpts: function() {
		var opts = [];
		for (var h = 0; h <= 23; h++) {
			var label = ('0' + h).slice(-2);
			opts.push(E('option', { 'value': String(h) }, label));
		}
		return opts;
	},

	minuteOpts: function() {
		return [0, 15, 30, 45].map(function(m) {
			return E('option', { 'value': String(m) }, ':' + ('0' + m).slice(-2));
		});
	},

	applySchedule: function(sched) {
		sched = sched || {};
		var freq = sched.frequency || 'disabled';
		var day  = String(sched.day != null ? sched.day : 1);
		var hour = String(sched.hour != null ? sched.hour : 0);
		var minute = String(sched.minute != null ? sched.minute : 0);

		this.schedFreq.value = freq;
		this.updateScheduleVisibility();

		/* Set day value after the options have been swapped */
		this.schedDay.value = day;
		this.schedHour.value = hour;
		this.schedMinute.value = minute;

		this.updateScheduleSummary();
	},

	updateScheduleSummary: function() {
		var freq = this.schedFreq.value;
		var msg;
		if (freq === 'disabled') {
			msg = _('Automatic rule updates are disabled.');
		} else {
			var h = ('0' + this.schedHour.value).slice(-2);
			var m = ('0' + this.schedMinute.value).slice(-2);
			var time = h + ':' + m;
			if (freq === 'daily') {
				msg = _('Rules will update daily at %s.').format(time);
			} else if (freq === 'weekly') {
				var dayLabel = '';
				for (var i = 0; i < WEEKDAYS.length; i++) {
					if (WEEKDAYS[i].val === this.schedDay.value) {
						dayLabel = WEEKDAYS[i].label;
						break;
					}
				}
				msg = _('Rules will update every %s at %s.').format(_(dayLabel), time);
			} else if (freq === 'monthly') {
				msg = _('Rules will update on day %s of each month at %s.').format(this.schedDay.value, time);
			}
		}
		dom.content(this.schedSummary, msg);
	},

	handleSaveSchedule: function() {
		var freq   = this.schedFreq.value;
		var day    = parseInt(this.schedDay.value, 10) || 0;
		var hour   = parseInt(this.schedHour.value, 10) || 0;
		var minute = parseInt(this.schedMinute.value, 10) || 0;

		this.schedSaveBtn.disabled = true;
		return callSetSchedule(freq, day, hour, minute).then(L.bind(function(res) {
			this.schedSaveBtn.disabled = false;
			if (res && res.success) {
				ui.addNotification(null, E('p', _('Update schedule saved.')), 'info');
				this.updateScheduleSummary();
			} else {
				ui.addNotification(null, E('p', (res && res.message) || _('Failed to save the schedule.')), 'danger');
			}
		}, this));
	},

	render: function(data) {
		var info = data[0] || {};
		var list = data[1] || {};
		var status = data[2] || {};
		var sched = data[3] || {};
		this.rulesDir = info.rules_dir || list.rules_dir || '/etc/snort/rules';

		this.infoHost = E('div', { 'class': 's3-grid' }, renderInfo(info));

		/* oinkcode section nodes */
		this.oinkInput = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'style': 'width:340px;max-width:100%',
			'value': info.oinkcode || '',
			'placeholder': _('40-character oinkcode')
		});

		/* update section nodes */
		this.progBar = E('span');
		this.progLabel = E('div', { 'class': 's3-progress-label' }, '');
		this.progLog = E('div', { 'class': 's3-console', 'style': 'max-height:220px;margin-top:10px' },
			E('div', { 'class': 's3-empty' }, _('No output yet.')));
		this.progWrap = E('div', { 'style': 'margin-top:12px;display:none' }, [
			E('div', { 'class': 's3-progress' }, this.progBar),
			this.progLabel,
			this.progLog
		]);

		this.updateBtn = E('button', {
			'class': 'btn cbi-button cbi-button-apply',
			'click': ui.createHandlerFn(this, 'handleUpdate')
		}, _('Download & install rules'));

		/* --- schedule section nodes --- */
		this.schedFreq = E('select', {
			'class': 'cbi-input-select',
			'style': 'min-width:140px',
			'change': L.bind(function() {
				this.updateScheduleVisibility();
				this.updateScheduleSummary();
			}, this)
		}, [
			E('option', { 'value': 'disabled' }, _('Disabled')),
			E('option', { 'value': 'daily' },    _('Daily')),
			E('option', { 'value': 'weekly' },   _('Weekly')),
			E('option', { 'value': 'monthly' },  _('Monthly'))
		]);

		this.schedDay = E('select', {
			'class': 'cbi-input-select',
			'style': 'min-width:120px',
			'change': L.bind(function() { this.updateScheduleSummary(); }, this)
		});

		this.schedHour = E('select', {
			'class': 'cbi-input-select',
			'style': 'min-width:90px',
			'change': L.bind(function() { this.updateScheduleSummary(); }, this)
		}, this.hourOpts());

		this.schedMinute = E('select', {
			'class': 'cbi-input-select',
			'style': 'min-width:70px',
			'change': L.bind(function() { this.updateScheduleSummary(); }, this)
		}, this.minuteOpts());

		this.schedSummary = E('div', { 'class': 's3-note', 'style': 'margin-top:6px' }, '');

		this.schedSaveBtn = E('button', {
			'class': 'btn cbi-button cbi-button-save',
			'click': ui.createHandlerFn(this, 'handleSaveSchedule')
		}, _('Save schedule'));

		this.schedDayRow = E('span', { 'style': 'display:inline-flex;align-items:center;gap:6px' }, [
			E('span', {}, _('on')),
			this.schedDay
		]);

		this.schedTimeRow = E('span', { 'style': 'display:inline-flex;align-items:center;gap:6px' }, [
			E('span', {}, _('at')),
			this.schedHour,
			this.schedMinute
		]);

		/* symlink section nodes */
		this.fileSelect = E('select', { 'class': 'cbi-input-select', 'style': 'min-width:280px' },
			this.ruleFileOptions(list.files, list.active));

		var body = E('div', { 'class': 'snort3' }, [
			E('link', { 'rel': 'stylesheet', 'href': L.resource('view/snort3/snort3.css') }),

			E('h2', {}, _('Rule Updates')),
			E('p', { 'class': 's3-note' },
				_('Download and manage Snort3 detection rules. With an oinkcode the version-matched subscription package is fetched; without one the free community ruleset is used.')),

			this.infoHost,

			/* --- subscription / oinkcode --------------------------------- */
			E('h3', {}, _('Subscription (oinkcode)')),
			E('p', { 'class': 's3-note' },
				_('A Snort.org oinkcode unlocks subscriber/registered rules. Leave it empty to use the free community rules. An inactive subscription still returns the free package. See https://www.snort.org/oinkcodes for details.')),
			E('div', { 'class': 's3-toolbar' }, [
				this.oinkInput,
				E('button', {
					'class': 'btn cbi-button cbi-button-save',
					'click': ui.createHandlerFn(this, 'handleSaveOink')
				}, _('Save oinkcode')),
				E('button', {
					'class': 'btn cbi-button cbi-button-reset',
					'click': ui.createHandlerFn(this, 'handleClearOink')
				}, _('Use community rules'))
			]),

			/* --- download ------------------------------------------------ */
			E('h3', { 'style': 'margin-top:20px' }, _('Update rules')),
			E('p', { 'class': 's3-note' }, [
				_('Community rules: '),
				E('code', {}, 'https://www.snort.org/downloads/community/snort3-community-rules.tar.gz'),
				E('br'),
				_('Subscription rules: '),
				E('code', {}, 'https://www.snort.org/rules/<file_name>?oinkcode=<oinkcode>')
			]),
			E('div', { 'class': 's3-toolbar' }, [
				this.updateBtn
			]),
			this.progWrap,

			/* --- schedule ------------------------------------------------ */
			E('h3', { 'style': 'margin-top:20px' }, _('Automatic update schedule')),
			E('p', { 'class': 's3-note' },
				_('Schedule automatic rule updates. A cron job will run the rule downloader at the configured time.')),
			E('div', { 'class': 's3-toolbar' }, [
				this.schedFreq,
				this.schedDayRow,
				this.schedTimeRow,
				this.schedSaveBtn
			]),
			this.schedSummary,

			/* --- symlink management -------------------------------------- */
			E('h3', { 'style': 'margin-top:20px' }, _('Active ruleset (symlink)')),
			E('p', { 'class': 's3-note' }, [
				_('Point '),
				E('code', {}, this.rulesDir + '/active.rules'),
				_(' at the rule file Snort should load. Reference active.rules from your snort.lua include so switching rulesets needs no config change.')
			]),
			E('div', { 'class': 's3-toolbar' }, [
				this.fileSelect,
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleLink')
				}, _('Set active'))
			])
		]);

		/* Apply the saved schedule to the dropdowns */
		this.applySchedule(sched);

		/* If an update is already running (detached worker), resume tracking. */
		if (status && status.running) {
			this.applyStatus(status);
			this.startStatusPoll();
		}

		return body;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
