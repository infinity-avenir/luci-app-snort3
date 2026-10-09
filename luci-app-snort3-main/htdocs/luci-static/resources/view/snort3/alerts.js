'use strict';
'require view';
'require rpc';
'require poll';
'require dom';
'require ui';

var callAlerts = rpc.declare({
	object: 'luci.snort3',
	method: 'getAlerts',
	params: [ 'limit' ],
	expect: { }
});

var callLog = rpc.declare({
	object: 'luci.snort3',
	method: 'getLog',
	params: [ 'limit' ],
	expect: { }
});

function statCard(title, value, cls) {
	return E('div', { 'class': 's3-card' }, [
		E('h4', {}, title),
		E('div', { 'class': 's3-metric', 'style': cls ? 'color:var(' + cls + ')' : '' }, String(value))
	]);
}

function priorityOf(line) {
	var m = /Priority:\s*(\d+)/.exec(line || '');
	return m ? parseInt(m[1], 10) : 0;
}

function renderStats(alerts) {
	alerts = alerts || [];
	var high = 0, med = 0, low = 0;
	alerts.forEach(function(a) {
		var p = priorityOf(a);
		if (p === 1) high++;
		else if (p === 2) med++;
		else low++;
	});
	return [
		statCard(_('Shown'), alerts.length),
		statCard(_('High (P1)'), high, '--s3-bad'),
		statCard(_('Medium (P2)'), med, '--s3-warn'),
		statCard(_('Low / other'), low, '--s3-ok')
	];
}

function renderConsole(lines, emptyMsg) {
	lines = lines || [];
	if (!lines.length)
		return E('div', { 'class': 's3-empty' }, emptyMsg);
	return lines.map(function(l) {
		return E('div', { 'class': 's3-row' }, l);
	});
}

return view.extend({
	load: function() {
		return Promise.all([ callAlerts(50), callLog(100) ]);
	},

	refresh: function() {
		return Promise.all([ callAlerts(50), callLog(100) ]).then(L.bind(function(res) {
			var alerts = (res[0] && res[0].alerts) || [];
			var log = (res[1] && res[1].lines) || [];
			if (this.statHost)
				dom.content(this.statHost, renderStats(alerts));
			if (this.alertHost)
				dom.content(this.alertHost, renderConsole(alerts, _('No alerts recorded yet.')));
			if (this.logHost)
				dom.content(this.logHost, renderConsole(log, _('No Snort entries in the system log.')));
		}, this));
	},

	render: function(data) {
		var alerts = (data[0] && data[0].alerts) || [];
		var alertFile = (data[0] && data[0].file) || '/var/log/snort/alert_fast.txt';
		var log = (data[1] && data[1].lines) || [];

		this.statHost  = E('div', { 'class': 's3-grid' }, renderStats(alerts));
		this.alertHost = E('div', { 'class': 's3-console' }, renderConsole(alerts, _('No alerts recorded yet.')));
		this.logHost   = E('div', { 'class': 's3-console' }, renderConsole(log, _('No Snort entries in the system log.')));

		var body = E('div', { 'class': 'snort3' }, [
			E('link', { 'rel': 'stylesheet', 'href': L.resource('view/snort3/snort3.css') }),

			E('h2', {}, _('Alerts & Logs')),
			E('p', { 'class': 's3-note' },
				_('Recent Snort alerts and related system log entries. Refreshes every 5 seconds.')),

			this.statHost,

			E('div', { 'class': 's3-toolbar' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, 'refresh')
				}, _('Refresh now'))
			]),

			E('h3', {}, _('Recent alerts (last 50)')),
			E('p', { 'class': 's3-note' }, _('Source: %s').format(alertFile)),
			this.alertHost,

			E('h3', { 'style': 'margin-top:22px' }, _('System log')),
			this.logHost
		]);

		poll.add(L.bind(this.refresh, this), 5);
		poll.start();

		return body;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
