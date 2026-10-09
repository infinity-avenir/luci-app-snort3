'use strict';
'require view';
'require rpc';
'require ui';
'require poll';
'require dom';

var callStatus = rpc.declare({
	object: 'luci.snort3',
	method: 'getStatus',
	expect: { }
});

var callServiceAction = rpc.declare({
	object: 'luci.snort3',
	method: 'serviceAction',
	params: [ 'action' ],
	expect: { }
});

function fmtKB(kb) {
	kb = kb || 0;
	if (kb >= 1048576)
		return (kb / 1048576).toFixed(2) + ' GiB';
	if (kb >= 1024)
		return (kb / 1024).toFixed(1) + ' MiB';
	return kb + ' KiB';
}

function badge(state, label) {
	return E('span', { 'class': 's3-badge ' + state }, label);
}

function card(title, body, sub) {
	return E('div', { 'class': 's3-card' }, [
		E('h4', {}, title),
		body,
		sub ? E('div', { 'class': 's3-sub' }, sub) : ''
	]);
}

function renderCards(s) {
	s = s || {};

	var running = !!s.running;
	var usedKB = (s.mem_total || 0) - (s.mem_available || 0);
	var memPct = s.mem_total ? Math.round(usedKB * 100 / s.mem_total) : 0;
	var ifUp = (s.interface_state === 'up');

	return [
		card(_('Service'),
			E('div', {}, [
				running ? badge('ok', _('Running')) : badge('bad', _('Stopped'))
			]),
			running
				? _('Mode: %s · DAQ: %s').format((s.mode || 'ids').toUpperCase(), s.method || '-')
				: _('Snort is not currently running')),

		card(_('Process'),
			E('div', { 'class': 's3-metric' }, running ? fmtKB(s.memory) : '—'),
			running ? _('PID %s · resident memory').format(s.pid || '?')
			        : _('No active process')),

		card(_('System memory'),
			E('div', {}, [
				E('div', { 'class': 's3-metric' }, fmtKB(usedKB)),
				E('div', { 'class': 's3-bar' }, E('span', { 'style': 'width:' + memPct + '%' }))
			]),
			_('%d%% of %s used').format(memPct, fmtKB(s.mem_total))),

		card(_('Alerts'),
			E('div', { 'class': 's3-metric' }, String(s.alerts || 0)),
			_('Total recorded in the alert log')),

		card(_('Monitored interface'),
			E('div', {}, [
				ifUp ? badge('ok', s.interface || '-') : badge('warn', s.interface || _('none'))
			]),
			ifUp ? _('Link is up') : _('Link is down or unset')),

		card(_('Auto-start'),
			E('div', {}, [
				s.autostart ? badge('ok', _('Enabled')) : badge('warn', _('Disabled'))
			]),
			s.autostart ? _('Starts automatically on boot')
			            : _('Will not start on boot'))
	];
}

return view.extend({
	load: function() {
		return callStatus();
	},

	handleAction: function(action, ev) {
		var verb = {
			start: _('start'), stop: _('stop'), restart: _('restart'),
			enable: _('enable auto-start'), disable: _('disable auto-start')
		}[action] || action;

		return callServiceAction(action).then(L.bind(function(res) {
			if (res && res.success)
				ui.addNotification(null, E('p', _('Snort: %s succeeded.').format(verb)), 'info');
			else
				ui.addNotification(null, E('p', _('Snort: %s failed. %s').format(verb, (res && res.message) || '')), 'danger');
			return this.refresh();
		}, this));
	},

	refresh: function() {
		return callStatus().then(L.bind(function(s) {
			if (this.cardHost)
				dom.content(this.cardHost, renderCards(s));
		}, this));
	},

	render: function(status) {
		this.cardHost = E('div', { 'class': 's3-grid' }, renderCards(status));

		var btn = L.bind(function(label, action, cls) {
			return E('button', {
				'class': 'btn cbi-button ' + cls,
				'click': ui.createHandlerFn(this, 'handleAction', action)
			}, label);
		}, this);

		var body = E('div', { 'class': 'snort3' }, [
			E('link', { 'rel': 'stylesheet', 'href': L.resource('view/snort3/snort3.css') }),

			E('h2', {}, _('Snort3 IDS/IPS')),
			E('p', { 'class': 's3-note' },
				_('Live status of the Snort3 engine. This page refreshes every 5 seconds.')),

			E('div', { 'class': 's3-toolbar' }, [
				btn(_('Start'),   'start',   'cbi-button-apply'),
				btn(_('Stop'),    'stop',    'cbi-button-negative'),
				btn(_('Restart'), 'restart', 'cbi-button-action'),
				E('span', { 'style': 'flex:1' }),
				btn(_('Enable auto-start'),  'enable',  'cbi-button-save'),
				btn(_('Disable auto-start'), 'disable', 'cbi-button-reset')
			]),

			this.cardHost
		]);

		poll.add(L.bind(this.refresh, this), 5);
		poll.start();

		return body;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
