'use strict';
'require view';
'require form';
'require rpc';
'require uci';

var callInterfaces = rpc.declare({
	object: 'luci.snort3',
	method: 'getInterfaces',
	expect: { interfaces: [] }
});

return view.extend({
	load: function() {
		return Promise.all([
			callInterfaces().catch(function() { return []; }),
			uci.load('snort')
		]);
	},

	render: function(data) {
		var devs = (data[0] || [])
			.filter(function(n) { return n && n !== 'lo'; })
			.sort();

		var current = uci.get('snort', 'snort', 'interface');
		if (current && devs.indexOf(current) < 0)
			devs.unshift(current);

		var m, s, o;

		m = new form.Map('snort', _('Snort3 Configuration'),
			_('Configure how the Snort3 engine inspects traffic. Changes are applied to the running service after you save and restart it from the Overview page.'));

		s = m.section(form.NamedSection, 'snort', 'snort');
		s.anonymous = true;
		s.addremove = false;

		s.tab('general', _('General'));
		s.tab('network', _('Networks'));
		s.tab('paths',   _('Paths'));
		s.tab('custom',  _('Custom Config'));

		/* --- General ------------------------------------------------------ */
		o = s.taboption('general', form.Flag, 'enabled', _('Enable Snort'),
			_('Master switch used by this app. The service is still controlled from the Overview page.'));
		o.rmempty = false;

		o = s.taboption('general', form.ListValue, 'interface', _('Network interface'),
			_('Interface Snort listens on. For a typical router this is the LAN bridge (br-lan) or the WAN device.'));
		if (devs.length)
			devs.forEach(function(n) { o.value(n); });
		else
			o.value('br-lan');
		o.rmempty = false;

		o = s.taboption('general', form.ListValue, 'mode', _('Operating mode'),
			_('IDS detects and logs only. IPS sits inline and can drop matching traffic — it requires an inline DAQ such as NFQ.'));
		o.value('ids', _('IDS — detect only'));
		o.value('ips', _('IPS — detect and block'));
		o.default = 'ids';

		o = s.taboption('general', form.ListValue, 'method', _('DAQ method'),
			_('Data AcQuisition module. afpacket is a passive copy (IDS); nfq inspects packets inline via netfilter queue (IPS); pcap is passive capture.'));
		o.value('afpacket', 'afpacket');
		o.value('nfq', 'nfq');
		o.value('pcap', 'pcap');
		o.value('dump', 'dump');
		o.default = 'afpacket';

		/* --- Networks ----------------------------------------------------- */
		o = s.taboption('network', form.Value, 'home_net', _('Home network'),
			_('Address range Snort treats as the protected network ($HOME_NET).'));
		o.placeholder = '192.168.1.0/24';
		o.datatype = 'or(cidr,ipaddr,string)';

		o = s.taboption('network', form.Value, 'external_net', _('External network'),
			_('Everything outside the home network ($EXTERNAL_NET). Usually "any".'));
		o.placeholder = 'any';

		/* --- Paths -------------------------------------------------------- */
		o = s.taboption('paths', form.Value, 'config_file', _('Main config file'),
			_('Path to the primary snort.lua configuration.'));
		o.placeholder = '/etc/snort/snort.lua';

		o = s.taboption('paths', form.Value, 'rules_dir', _('Rules directory'),
			_('Directory where downloaded rule files are installed.'));
		o.placeholder = '/etc/snort/rules';

		o = s.taboption('paths', form.Value, 'log_dir', _('Log directory'),
			_('Directory Snort writes its logs to.'));
		o.placeholder = '/var/log/snort';

		o = s.taboption('paths', form.Value, 'alert_file', _('Alert file'),
			_('Fast-alert file shown on the Alerts page. Produced by the alert_fast output plugin.'));
		o.placeholder = '/var/log/snort/alert_fast.txt';

		/* --- Custom config ------------------------------------------------ */
		o = s.taboption('custom', form.TextValue, 'custom_config', _('Custom Snort Lua'),
			_('Appended verbatim to the generated configuration. Use it for tuning, suppressions or output plugins. Leave empty if unsure.'));
		o.rows = 14;
		o.monospace = true;
		o.placeholder = '-- e.g.\n-- suppress = { { gid = 1, sid = 2100498 } }';

		return m.render().then(function(mapEl) {
			return E('div', { 'class': 'snort3' }, [
				E('link', { 'rel': 'stylesheet', 'href': L.resource('view/snort3/snort3.css') }),
				mapEl
			]);
		});
	}
});
