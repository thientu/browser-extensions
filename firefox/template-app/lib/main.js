// Config
var config = {uuid: "${uuid}"};

// Jetpack libraries
var pageWorker = require("page-worker");
var pageMod = require("page-mod");
var data = require("self").data;
var request = require("request");
var notif = require("notifications");
var ui = require("sdk/ui");

var ss = require('sdk/simple-prefs');

let {Cc, Ci} = require('chrome');
let querystring = require('sdk/querystring');
let cookie_service = Cc["@mozilla.org/cookieService;1"].getService(Ci['nsICookieService']);
let io_service = Cc["@mozilla.org/network/io-service;1"].getService(Ci['nsIIOService']);
const events = require("sdk/system/events");

var button;
var workers = [];
var background;

var addWorker = function (worker) {
	workers.push(worker);
}
var removeWorker = function (worker) {
	var index = workers.indexOf(worker);
	if (index != -1) {
		workers.splice(index, 1);
	}
}
var attachWorker = function (worker) {
	addWorker(worker);
	worker.on('detach', function () {
		removeWorker(this);
	});
	worker.on('message', handleNonPrivCall);
}
var handleNonPrivCall = function(msg) {
	var self = this;
	var handleResult = function (status) {
		return function(content) {
			// create and send response message
			var reply = {callid: msg.callid, status: status, content: content};
			try {
				self.postMessage(reply);
			} catch (e) {
				// Probably a dead callback
				// TODO: GC somehow
			}
		}
	}
	call(msg.method, msg.params, self, handleResult('success'), handleResult('error'));
};

var nullFn = function () {};
var call = function(methodName, params, worker, success, error) {
	var strparams = "parameters could not be stringified";
	try {
		strparams = JSON.stringify(params);
	} catch (e) { }
	//apiImpl.logging.log({
	//	message: "Received call to "+methodName+" with parameters: "+strparams,
	//	level: 10
	//}, nullFn, nullFn);

	if (!success) {
		success = nullFn;
	}
	if (!error) {
		error = nullFn;
	}

	try {
		// descend into API with dot-separated names
		var methodParts = methodName.split('.'),
		method = apiImpl;

		for (var i=0; i<methodParts.length; i++) {
			method = method[methodParts[i]];
		}

		if (typeof(method) !== 'function') {
			// tried to call non-existent API method
			error({message: methodName+' does not exist', type: "UNAVAILABLE"});
		}

		method.call(worker, params, function() {
			var strargs = "arguments could not be stringified";
			try {
				strargs = JSON.stringify(arguments);
			} catch (e) { }
			//apiImpl.logging.log({
				//message: 'Call to '+methodName+'('+strparams+') succeeded: '+strargs,
				//level: 10
			//}, nullFn, nullFn);
			success.apply(this, arguments);
		}, function() {
			var strargs = "arguments could not be stringified";
			try {
				strargs = JSON.stringify(arguments);
			} catch (e) { }
			//apiImpl.logging.log({
			//	message: 'Call to '+methodName+'('+strparams+') failed: '+strargs,
			//	level: 30
			//}, nullFn, nullFn);
			error.apply(this, arguments);
		});
	} catch (e) {
		error({message: 'Unknown error: '+e, type: "UNEXPECTED_FAILURE"})
	}
};

var apiImpl = {
	message: function (params) {
		var broadcast = {event: params.event, data: params.data, type: "message"};
		if (params.event == 'toFocussed') {
			broadcast.event = 'broadcast';
		}
		background.postMessage(broadcast);
		workers.forEach(function (worker) {
			if (params.event !== 'toFocussed' || worker.tab === require("tabs").activeTab) {
				try {
					worker.postMessage(broadcast);
				} catch (e) {
					// Probably just an about-to-be-removed worker, don't worry about it
				}
			}
		});
	},
	button: {
    setIcon: function (url, success, error) {
      error({message: 'Not implemented', type: "UNAVAILABLE"});
    },
    setURL: function (url, success, error) {
      error({message: 'Not implemented', type: "UNAVAILABLE"});
    },
    setTitle: function (title, success, error) {
      error({message: 'Not implemented', type: "UNAVAILABLE"});
    },
    setBadge: function (badgeText, success, error) {
      if (button) {
        button.badge = badgeText
        success();
      }
    },
    setBadgeBackgroundColor: function (badgeBGColor, success, error) {
      error({message: 'Not implemented', type: "UNAVAILABLE"});
    },
    onClicked: {
      addListener: function (params, callback, error) {
        error({message: 'Not implemented', type: "UNAVAILABLE"});
      }
    }
	},
	logging: {
		log: function (params, success, error) {
			if (typeof console !== "undefined") {
				switch (params.level) {
					case 10:
						if (console.debug !== undefined && !(console.debug.toString && console.debug.toString().match('alert'))) {
							console.debug(params.message);
						}
						break;
					case 30:
						if (console.warn !== undefined && !(console.warn.toString && console.warn.toString().match('alert'))) {
							console.warn(params.message);
						}
						break;
					case 40:
					case 50:
						if (console.error !== undefined && !(console.error.toString && console.error.toString().match('alert'))) {
							console.error(params.message);
						}
						break;
					default:
					case 20:
						if (console.info !== undefined && !(console.info.toString && console.info.toString().match('alert'))) {
							console.info(params.message);
						}
						break;
				}
				success();
			}
		}
	},
	tools: {
		getURL: function (params, success, error) {
			name = params.name.toString();
			if (name.indexOf("http://") === 0 || name.indexOf("https://") === 0) {
				success(name);
			} else {
				success(data.url('src'+(name.substring(0,1) == '/' ? '' : '/')+name));
			}
		}
	},
	notification: {
		create: function (params, success, error) {
			require("notifications").notify({
				title: params.title,
				text: params.text,
        iconURL: params.iconURL,
        onClick: success
			});
		}
	},
	tabs: {
    allTabs: function(params, success) {
      var tabs = [];

      for (let tab of require('tabs')) {
        tabs.push({
          url: tab.url,
          id: tab.id,
          title: tab.title
        });
      }

      success(tabs);
    },
    reload: function(params, success) {
      for (let tab of require('tabs')) {
        if (tab.id == params.id) {
          tab.reload();
          success();
        }
      }
    },
    getCurrentTabUrl: function(params, success) {
      success(require('tabs').activeTab.url);
    },
		open: function(params, success, error) {
			require('tabs').open({
				url: params.url,
				inBackground: params.keepFocus,
				onOpen: function () {
					success();
				}
			});
		},
    updateCurrent: function (params, success) {
      var tab = require('tabs').activeTab;
      tab.url = params.url;
      success(tab)
    },
		closeCurrent: function () {
			this.tab.close();
		}
	},
	request: {
		ajax: function (params, success, error) {

			var complete = false;
			var timer = require('timers').setTimeout(function () {
				if (complete) return;
				complete = true;
				error && error({
					message: 'Request timed out',
					type: 'EXPECTED_FAILURE'
				});
			}, params.timeout ? params.timeout : 60000);

			var req = request.Request({
				url: params.url,
				onComplete: function (res) {
					require('timers').clearTimeout(timer);
					if (complete) return;
					complete = true;

					if (res.status >= 200 && res.status < 400) {
						success(res.text)
					} else {
						error({message: "HTTP error code received from server: "+res.status,
							statusCode: res.status,
							type: "EXPECTED_FAILURE"});
					}
				},
				// TODO: encode strings etc:
				content: params.data,
				headers: params.headers
			});
			if (params.type == 'POST') {
				req.post();
			} else {
				req.get();
			}
		}
	},
	prefs: {
		get: function(params, success, error) {
			//success(ss.storage.prefs[params.key] === undefined ? "undefined" : ss.storage.prefs[params.key]);
			success(ss.prefs[params.key] === undefined ? "undefined" : ss.prefs[params.key]);
		},
		set: function(params, success, error) {
			ss.prefs[params.key] = params.value
			success();
		},
		keys: function(params, success, error) {
			success(Object.keys(ss.prefs));
		},
		all: function(params, success, error) {
			success(ss.prefs);
		},
		clear: function(params, success, error) {
			delete ss.prefs[params.key];
			success();
		},
		clearAll: function(params, success, error) {
      error({message: 'Not implemented', type: "UNAVAILABLE"});
		}
	},
	file: {
		string: function (file, success, error) {
			success(data.load(file.uri.substring(data.url('').length)));
		}
	},
  cookies: {
    get: function(p, cb) {
      var uri = io_service.newURI('https://' + p.domain + p.path, null, null);
      var cookies_string = cookie_service.getCookieString(uri, null);
      var cookie_pairs = querystring.parse(cookies_string, '; ', '=');
      var cookie_val = cookie_pairs[p.name];
      cb(cookie_val);
    },
    set: function (p, cb) {
      cb = cb || function () {}
      setTimeout(cb, 10)
    },
    watch: function(p, cb) {
      function handleCookie(cookie, type) {
        if (cookie.path != p.path || cookie.name != p.name) return;
        if (!cookie.host.endsWith(p.domain)) return;

        if (type == 'delete') cb();
        else cb(cookie.value);
      }

      events.on('cookie-changed', function(e) {
        switch (e.data) {
          case 'cleared': return cb();
          case 'added': return handleCookie(e.subject.QueryInterface(Ci['nsICookie2']), 'update');
          case 'changed': return handleCookie(e.subject.QueryInterface(Ci['nsICookie2']), 'update');
          case 'deleted': return handleCookie(e.subject.QueryInterface(Ci['nsICookie2']), 'delete');
          case 'batch-deleted':
            var enumerator = e.subject.QueryInterface(Ci['nsIArray']).enumerate();
            while (enumerator.hasMoreElements())
              handleCookie(enumerator.getNext().QueryInterface(Ci['nsICookie2']));
            break;
        }
      }, true);
    }
  }
};

// Load the extension
exports.main = function(options, callbacks) {
	// Button
	{% if "button" in plugins and "config" in plugins["button"] %}
  button = ui.ActionButton({
		id: config.id + "-button"
		{% if "default_title" in plugins["button"]["config"] %}, label: ${json.dumps(plugins['button']["config"]['default_title'])}{% end %}
		, icon: <%=JSON.stringify(_.mapValues(config.modules.icons.firefox, function(v) { return './src/' + v; }))%>,
    onClick: function(state) {
      var panel = require("panel").Panel({
        contentURL: data.url("src/popup.html"),
        contentScriptFile: data.url("forge/api-firefox-proxy.js"),
        contentScriptWhen: "start",
        onMessage: handleNonPrivCall,
        onHide: function () {
          removeWorker(this);
          // Completely remove panel from DOM
          this.destroy();
        }
      });

      panel.port.on('winsize', function(data) {
        panel.resize(data.width, data.height);
      });

      require("tabs").on('open', function() {
        panel && panel.hide();
      });

      // Keep the panel in the list of workers for messaging
      addWorker(panel);
      panel.show({position: button});
    }
	});
	{% end %}

	// Background page
	background = pageWorker.Page({
		contentURL: data.url('forge.html'),
		contentScriptFile: data.url("forge/api-firefox-proxy.js"),
		contentScriptWhen: "start",
		onMessage: handleNonPrivCall
	});

	// Convert between chrome match patterns and regular expressions
	var patternToRe = function (str) {
		if (str == '<all_urls>') {
			str = '*://*'
		}
		str = str.split('://');
		var scheme = str[0];
		var host, path;
		if (str[1].indexOf('/') === -1) {
			host = str[1];
			path = '';
		} else {
			host = str[1].substring(0, str[1].indexOf('/'));
			path = str[1].substring(str[1].indexOf('/'));
		}

		var re = '';

		// Scheme
		if (scheme == '*') {
			re += '(http|https|file|ftp)://';
		} else if (['http','https','file','ftp'].indexOf(scheme) !== -1) {
			re += scheme+'://';
		} else {
			// Invalid scheme
			return new RegExp('^$');
		}

		// Host
		if (host == '*') {
			re += '.*';
		} else if (host.indexOf('*.') === 0) {
			re += '(.+\.)?'+host.substring(2);
		} else {
			re += host;
		}

		// Path
		re += path.replace(/\*/g, '.*');

		return new RegExp(re);
	}
	var patternsToRe = function (arr) {
		if (arr.map) {
			return arr.map(patternToRe);
		} else {
			return patternToRe(arr);
		}
	}
	var strArrToDataUrl = function (arr) {
		if (arr.map) {
			return arr.map(data.url);
		} else {
			return data.url(arr);
		}
	};

{% if "activations" in plugins and "config" in plugins["activations"] and "activations" in plugins["activations"]["config"] and len(plugins["activations"]["config"]["activations"]) %}{% for activation in plugins["activations"]["config"]["activations"] %}
	pageMod.PageMod({
		include: patternsToRe(${json.dumps(activation.patterns)}),
		{% if activation.has_key("all_frames") and activation["all_frames"] is True %}
			contentScriptFile: strArrToDataUrl(${json.dumps(["forge/app_config.js", "forge/all.js"] + activation.scripts)}),
		{% end %} {% if not activation.has_key("all_frames") or activation["all_frames"] is False %}
			contentScriptFile: strArrToDataUrl(${json.dumps(["forge/app_config.js", "forge/all.js", "forge/disable-frames.js"] + activation.scripts)}),
		{% end %}
		{% if activation.has_key("styles") %}
		contentStyleFile: strArrToDataUrl(${json.dumps(activation.styles)}),
		{% end %}
		{% if activation.has_key("run_at") %}
			contentScriptWhen: ${json.dumps(activation.run_at)},
		{% end %} {% if not activation.has_key("run_at") %}
			contentScriptWhen: 'end',
		{% end %}
		onAttach: attachWorker
	});
{% end %}{% end %}

	// Local pages
	pageMod.PageMod({
		include: data.url('')+'*',
		contentScriptFile: data.url("forge/api-firefox-proxy.js"),
		contentScriptWhen: 'start',
		onAttach: attachWorker
	});
};
