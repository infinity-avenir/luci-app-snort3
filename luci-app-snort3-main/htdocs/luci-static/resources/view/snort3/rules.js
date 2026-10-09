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
	object: 'luci.snort3', method: 'startUpdate', params: [ 'url' ], expect: { }
});
var callUpdateStatus = rpc.declare({
	object: 'luci.snort3', method: 'getUpdateStatus', expect: { }
});
var callSetOinkcode = rpc.declare({
	object: 'luci.snort3', method: 'setOinkcode', params: [ 'oinkcode' ], expect: { }
});
var callSetRuleEnabled = rpc.declare({
	object: 'luci.snort3', method: 'setRuleEnabled', params: [ 'name', 'enabled' ], expect: { }
});
var callSetAllRules = rpc.declare({
	object: 'luci.snort3', method: 'setAllRules', params: [ 'enabled' ], expect: { }
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
	var date, dateSub;
	if (info.last_update_time) {
		date = new Date(info.last_update_time * 1000).toLocaleString();
		dateSub = (info.last_update_rules || 0) + ' rules at last update';
	} else {
		date = _('never');
		dateSub = '';
	}
	var source = info.oinkcode_set
		? _('Subscription')
		: _('Community (free)');
	return [
		infoCard(_('Installed rules'), info.rule_count || 0, _('signatures across all rule files')),
		infoCard(_('Last updated'), date, dateSub, true),
		infoCard(_('Snort version'), info.snort_version || _('unknown'), info.snapshot_name || '', true),
		infoCard(_('Active source'), source, info.oinkcode_set ? info.snapshot_name : _('no oinkcode set'), true)
	];
}

/* Day-of-week labels */
var WEEKDAYS = [
	{ val: '0', label: 'Sunday' },
	{ val: '1', label: 'Monday' },
	{ val: '2', label: 'Tuesday' },
	{ val: '3', label: 'Wednesday' },
	{ val: '4', label: 'Thursday' },
	{ val: '5', label: 'Friday' },
	{ val: '6', label: 'Saturday' }
];

var RULE_SOURCES = [
	{ val: 'community', label: 'Community rules (free, no oinkcode)' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-31470.tar.gz', label: 'snortrules-snapshot-31470' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-31440.tar.gz', label: 'snortrules-snapshot-31440' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-31350.tar.gz', label: 'snortrules-snapshot-31350' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-31210.tar.gz', label: 'snortrules-snapshot-31210' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-31200.tar.gz', label: 'snortrules-snapshot-31200' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-31180.tar.gz', label: 'snortrules-snapshot-31180' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-31150.tar.gz', label: 'snortrules-snapshot-31150' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-31110.tar.gz', label: 'snortrules-snapshot-31110' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-31100.tar.gz', label: 'snortrules-snapshot-31100' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-3900.tar.gz',  label: 'snortrules-snapshot-3900' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-3700.tar.gz',  label: 'snortrules-snapshot-3700' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-3370.tar.gz',  label: 'snortrules-snapshot-3370' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-3360.tar.gz',  label: 'snortrules-snapshot-3360' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-3351.tar.gz',  label: 'snortrules-snapshot-3351' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-3200.tar.gz',  label: 'snortrules-snapshot-3200' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-29200.tar.gz', label: 'snortrules-snapshot-29200' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-29181.tar.gz', label: 'snortrules-snapshot-29181' },
	{ val: 'https://snort.org/rules/snortrules-snapshot-29171.tar.gz', label: 'snortrules-snapshot-29171' },
	{ val: 'custom',    label: 'Custom URL...' }
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

	/* ---- status / progress ---- */
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
					this.refreshRuleList();
				}
			}, this));
		}, this);
		poll.add(this._pollFn, 2);
		poll.start();
	},

	refreshInfo: function() {
		return callRulesInfo().then(L.bind(function(info) {
			info = info || {};
			this.rulesDir = info.rules_dir || this.rulesDir;
			dom.content(this.infoHost, renderInfo(info));
		}, this));
	},

	/* ---- rule file list ---- */
	refreshRuleList: function() {
		return callListRules().then(L.bind(function(list) {
			list = list || {};
			this.ruleFiles = list.files || [];
			this.renderRuleList();
		}, this));
	},

	renderRuleList: function() {
		var files = this.ruleFiles || [];
		var enabledCount = 0;
		files.forEach(function(f) { if (f.enabled) enabledCount++; });

		dom.content(this.ruleCountLabel,
			_('%d of %d rule files enabled').format(enabledCount, files.length));

		var rows = [];
		files.sort(function(a, b) { return a.name.localeCompare(b.name); });

		for (var i = 0; i < files.length; i++) {
			(function(self, f) {
				var toggleBtn = E('button', {
					'class': 'btn cbi-button ' + (f.enabled ? 'cbi-button-negative' : 'cbi-button-apply'),
					'style': 'min-width:80px;font-size:0.85em',
					'click': ui.createHandlerFn(self, 'handleToggleRule', f.name, !f.enabled)
				}, f.enabled ? _('Disable') : _('Enable'));

				var row = E('div', {
					'class': 's3-rule-row',
					'style': 'display:flex;align-items:center;padding:6px 10px;' +
						'border-bottom:1px solid #eee;' +
						(f.enabled ? '' : 'opacity:0.6;')
				}, [
					E('span', {
						'class': 's3-rule-status',
						'style': 'width:10px;height:10px;border-radius:50%;margin-right:10px;' +
							'background:' + (f.enabled ? '#4caf50' : '#ccc')
					}),
					E('span', { 'style': 'flex:1;font-family:monospace;font-size:0.9em' }, f.name),
					E('span', { 'style': 'width:80px;text-align:right;color:#888;font-size:0.85em;margin-right:12px' },
						(f.sigs || 0) + ' sigs'),
					toggleBtn
				]);
				rows.push(row);
			})(this, files[i]);
		}

		if (!rows.length) {
			rows.push(E('div', { 'class': 's3-empty', 'style': 'padding:20px;text-align:center' },
				_('No rule files installed yet.')));
		}

		dom.content(this.ruleListHost, rows);
	},

	handleToggleRule: function(name, enable) {
		return callSetRuleEnabled(name, enable).then(L.bind(function(res) {
			if (res && res.success) {
				/* Update local state without refetching */
				for (var i = 0; i < this.ruleFiles.length; i++) {
					if (this.ruleFiles[i].name === name) {
						this.ruleFiles[i].enabled = enable;
						break;
					}
				}
				this.renderRuleList();
			} else {
				ui.addNotification(null, E('p', _('Failed to update rule: %s').format(name)), 'danger');
			}
		}, this));
	},

	handleEnableAll: function() {
		return callSetAllRules(true).then(L.bind(function(res) {
			if (res && res.success) {
				ui.addNotification(null, E('p', _('All rule files enabled.')), 'info');
				return this.refreshRuleList();
			}
		}, this));
	},

	handleDisableAll: function() {
		return callSetAllRules(false).then(L.bind(function(res) {
			if (res && res.success) {
				ui.addNotification(null, E('p', _('All rule files disabled.')), 'info');
				return this.refreshRuleList();
			}
		}, this));
	},

	/* ---- oinkcode ---- */
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
				ui.addNotification(null, E('p', _('Oinkcode saved.')), 'info');
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
				ui.addNotification(null, E('p', _('Oinkcode cleared.')), 'info');
			}
			return this.refreshInfo();
		}, this));
	},

	/* ---- update / download ---- */
	handleUpdate: function() {
		var sel = this.ruleSourceSelect.value;
		var url = '';
		if (sel === 'custom') {
			url = (this.customUrlInput.value || '').trim();
			if (!url) {
				ui.addNotification(null, E('p', _('Enter a custom URL first.')), 'warning');
				return Promise.resolve();
			}
		} else if (sel === 'community') {
			url = 'community';
		} else {
			url = sel;
		}

		return callStartUpdate(url).then(L.bind(function(res) {
			if (res && res.started) {
				this.applyStatus({ running: true, phase: 'queued', percent: 0, message: _('Starting…'), log: '' });
				this.startStatusPoll();
			} else {
				ui.addNotification(null, E('p', (res && res.message) || _('Could not start the update.')), 'warning');
			}
		}, this));
	},

	/* ---- schedule helpers ---- */
	updateScheduleVisibility: function() {
		var freq = this.schedFreq.value;
		this.schedDayRow.style.display = (freq === 'monthly' || freq === 'weekly') ? '' : 'none';
		this.schedTimeRow.style.display = (freq !== 'disabled') ? '' : 'none';
		if (freq === 'monthly') {
			dom.content(this.schedDay, this.monthDayOpts());
		} else if (freq === 'weekly') {
			dom.content(this.schedDay, this.weekDayOpts());
		}
	},

	monthDayOpts: function() {
		var opts = [];
		for (var d = 1; d <= 30; d++)
			opts.push(E('option', { 'value': String(d) }, String(d)));
		return opts;
	},
	weekDayOpts: function() {
		return WEEKDAYS.map(function(w) {
			return E('option', { 'value': w.val }, _(w.label));
		});
	},
	hourOpts: function() {
		var opts = [];
		for (var h = 0; h <= 23; h++)
			opts.push(E('option', { 'value': String(h) }, ('0' + h).slice(-2)));
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
					if (WEEKDAYS[i].val === this.schedDay.value) { dayLabel = WEEKDAYS[i].label; break; }
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

	/* ================ render ================ */
	render: function(data) {
		var info = data[0] || {};
		var list = data[1] || {};
		var status = data[2] || {};
		var sched = data[3] || {};
		this.rulesDir = info.rules_dir || list.rules_dir || '/etc/snort/rules';
		this.ruleFiles = list.files || [];

		this.infoHost = E('div', { 'class': 's3-grid' }, renderInfo(info));

		/* oinkcode */
		this.oinkInput = E('input', {
			'type': 'text', 'class': 'cbi-input-text',
			'style': 'width:340px;max-width:100%',
			'value': info.oinkcode || '',
			'placeholder': _('40-character oinkcode')
		});

		/* progress */
		this.progBar = E('span');
		this.progLabel = E('div', { 'class': 's3-progress-label' }, '');
		this.progLog = E('div', { 'class': 's3-console', 'style': 'max-height:220px;margin-top:10px' },
			E('div', { 'class': 's3-empty' }, _('No output yet.')));
		this.progWrap = E('div', { 'style': 'margin-top:12px;display:none' }, [
			E('div', { 'class': 's3-progress' }, this.progBar),
			this.progLabel, this.progLog
		]);

		this.updateBtn = E('button', {
			'class': 'btn cbi-button cbi-button-apply',
			'click': ui.createHandlerFn(this, 'handleUpdate')
		}, _('Download & install rules'));

		/* rule source dropdown */
		this.ruleSourceSelect = E('select', {
			'class': 'cbi-input-select',
			'style': 'min-width:340px;max-width:100%',
			'change': L.bind(function() {
				this.customUrlRow.style.display = (this.ruleSourceSelect.value === 'custom') ? '' : 'none';
			}, this)
		}, RULE_SOURCES.map(function(s) {
			return E('option', { 'value': s.val }, _(s.label));
		}));

		this.customUrlInput = E('input', {
			'type': 'text', 'class': 'cbi-input-text',
			'style': 'width:100%',
			'placeholder': _('https://example.com/path/to/rules.tar.gz')
		});
		this.customUrlRow = E('div', { 'style': 'margin-top:6px;display:none' }, [ this.customUrlInput ]);

		/* schedule */
		this.schedFreq = E('select', {
			'class': 'cbi-input-select', 'style': 'min-width:140px',
			'change': L.bind(function() { this.updateScheduleVisibility(); this.updateScheduleSummary(); }, this)
		}, [
			E('option', { 'value': 'disabled' }, _('Disabled')),
			E('option', { 'value': 'daily' },    _('Daily')),
			E('option', { 'value': 'weekly' },   _('Weekly')),
			E('option', { 'value': 'monthly' },  _('Monthly'))
		]);
		this.schedDay = E('select', {
			'class': 'cbi-input-select', 'style': 'min-width:120px',
			'change': L.bind(function() { this.updateScheduleSummary(); }, this)
		});
		this.schedHour = E('select', {
			'class': 'cbi-input-select', 'style': 'min-width:90px',
			'change': L.bind(function() { this.updateScheduleSummary(); }, this)
		}, this.hourOpts());
		this.schedMinute = E('select', {
			'class': 'cbi-input-select', 'style': 'min-width:70px',
			'change': L.bind(function() { this.updateScheduleSummary(); }, this)
		}, this.minuteOpts());
		this.schedSummary = E('div', { 'class': 's3-note', 'style': 'margin-top:6px' }, '');
		this.schedSaveBtn = E('button', {
			'class': 'btn cbi-button cbi-button-save',
			'click': ui.createHandlerFn(this, 'handleSaveSchedule')
		}, _('Save schedule'));
		this.schedDayRow = E('span', { 'style': 'display:inline-flex;align-items:center;gap:6px' }, [
			E('span', {}, _('on')), this.schedDay
		]);
		this.schedTimeRow = E('span', { 'style': 'display:inline-flex;align-items:center;gap:6px' }, [
			E('span', {}, _('at')), this.schedHour, this.schedMinute
		]);

		/* rule file list */
		this.ruleCountLabel = E('span', { 'style': 'color:#666' }, '');
		this.ruleListHost = E('div', {
			'style': 'border:1px solid #ddd;border-radius:6px;max-height:420px;overflow-y:auto;background:#fff'
		});

		/* assemble page */
		var body = E('div', { 'class': 'snort3' }, [
			E('link', { 'rel': 'stylesheet', 'href': L.resource('view/snort3/snort3.css') }),

			E('h2', {}, _('Rule Updates')),
			E('p', { 'class': 's3-note' },
				_('Download and manage Snort3 detection rules.')),
			this.infoHost,

			/* oinkcode */
			E('h3', {}, _('Subscription (oinkcode)')),
			E('p', { 'class': 's3-note' },
				_('A Snort.org oinkcode unlocks subscriber/registered rules. Leave empty for free community rules.')),
			E('div', { 'class': 's3-toolbar' }, [
				this.oinkInput,
				E('button', { 'class': 'btn cbi-button cbi-button-save',
					'click': ui.createHandlerFn(this, 'handleSaveOink') }, _('Save oinkcode')),
				E('button', { 'class': 'btn cbi-button cbi-button-reset',
					'click': ui.createHandlerFn(this, 'handleClearOink') }, _('Use community rules'))
			]),

			/* download */
			E('h3', { 'style': 'margin-top:20px' }, _('Update rules')),
			E('p', { 'class': 's3-note' },
				_('Select a rule source or enter a custom URL. Oinkcode is appended automatically.')),
			E('div', { 'style': 'margin-bottom:8px' }, [
				this.ruleSourceSelect, this.customUrlRow
			]),
			E('div', { 'class': 's3-toolbar' }, [ this.updateBtn ]),
			this.progWrap,

			/* schedule */
			E('h3', { 'style': 'margin-top:20px' }, _('Automatic update schedule')),
			E('p', { 'class': 's3-note' },
				_('Schedule automatic rule updates via cron.')),
			E('div', { 'class': 's3-toolbar' }, [
				this.schedFreq, this.schedDayRow, this.schedTimeRow, this.schedSaveBtn
			]),
			this.schedSummary,

			/* rule files */
			E('h3', { 'style': 'margin-top:20px' }, _('Rule files')),
			E('div', { 'style': 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px' }, [
				E('p', { 'class': 's3-note', 'style': 'margin:0' }, [
					_('Enable or disable individual rule files. Enabled files are included in '),
					E('code', {}, 'active.rules'),
					_('.  '),
					this.ruleCountLabel
				]),
				E('div', { 'style': 'display:flex;gap:6px;flex-shrink:0' }, [
					E('button', { 'class': 'btn cbi-button cbi-button-apply', 'style': 'font-size:0.85em',
						'click': ui.createHandlerFn(this, 'handleEnableAll') }, _('Enable all')),
					E('button', { 'class': 'btn cbi-button cbi-button-reset', 'style': 'font-size:0.85em',
						'click': ui.createHandlerFn(this, 'handleDisableAll') }, _('Disable all'))
				])
			]),
			this.ruleListHost
		]);

		/* populate */
		this.renderRuleList();
		this.applySchedule(sched);

		/* Restore saved rule source selection */
		if (info.update_source) {
			var found = false;
			for (var i = 0; i < RULE_SOURCES.length; i++) {
				if (RULE_SOURCES[i].val === info.update_source) {
					this.ruleSourceSelect.value = info.update_source;
					found = true;
					break;
				}
			}
			if (!found && info.update_source !== 'community') {
				this.ruleSourceSelect.value = 'custom';
				this.customUrlInput.value = info.update_source;
				this.customUrlRow.style.display = '';
			}
		}

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
