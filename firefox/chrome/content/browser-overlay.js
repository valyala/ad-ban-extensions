// Use strict mode. https://developer.mozilla.org/en/JavaScript/Strict_mode .
"use strict";

// use this scoping hack in order to hide objects defined inside the anonymous function
// from the global scope.
(function() {
  const Cc = Components.classes;
  const Ci = Components.interfaces;

  const SCHEME_REGEXP = new RegExp('^[a-z]+:/{2}?', 'i');
  const SCHEME_AND_HOST_REGEXP = new RegExp('^[a-z]+:/{2}?[^/]*', 'i');

  const prompts = Cc['@mozilla.org/embedcomp/prompt-service;1'].getService(Ci.nsIPromptService);
  const adban = Cc['@ad-ban.appspot.com/adban;1'].getService().wrappedJSObject;
  const logging = adban.logging;
  const pref_branch = adban.pref_branch;

  const $ = function(id) {
    return document.getElementById(id);
  };

  const _ = function(id, params) {
    const adban_strings = $('adban-strings');
    if (params) {
      return adban_strings.getFormattedString(id, params);
    }
    return adban_strings.getString(id);
  };

  const getCurrentSiteUrl = function() {
    let current_site_url = $('urlbar').value;
    // add dummy scheme if it is missing
    if (current_site_url && !SCHEME_REGEXP.test(current_site_url)) {
      current_site_url = 'http://' + current_site_url;
    }
    const match = SCHEME_AND_HOST_REGEXP.exec(current_site_url);
    return match ? match[0] : '';
  };

  const getUrlWithoutScheme = function(url) {
    return url.replace(SCHEME_REGEXP, '');
  };

  const conditionalAlert = function(alert_name, msg) {
    alert_name = 'alert-states.' + alert_name;
    if (pref_branch.prefHasUserValue(alert_name) &&
        pref_branch.getBoolPref(alert_name)) {
      logging.info('the alert [%s] is disabled in preferences', alert_name);
      return;
    }
    const state_obj = {
        value: false,
    };
    prompts.alertCheck(window, 'AdvertBan', msg, _('dont-show-this-message-again'), state_obj);
    if (state_obj.value) {
      logging.info('disabling the alert [%s] in preferences', alert_name);
      pref_branch.setBoolPref(alert_name, true);
    }
  };

  const setupToolbarButtons = function() {
    const nav_bar = $('nav-bar');
    if (!nav_bar) {
      logging.warning('there is no navigation bar in the current window');
      return;
    }
    if ($('adban-toolbarbutton')) {
      logging.warning('the adban-toolbarbutton is already installed');
      return;
    }

    logging.info('adding adban buttons to navigation bar');
    nav_bar.insertItem('adban-toolbarbutton', null, null, false);

    // this 'magic' is necessary for FF, which can't properly handle
    // toolbar.insertItem().
    // See http://forums.mozillazine.org/viewtopic.php?t=189667 .
    nav_bar.setAttribute('currentset', nav_bar.currentSet);
    document.persist('nav-bar', 'currentset');
    logging.info('adban buttons must be added to navigation bar');
  };

  const processDocumentEventHandler = function(e) {
    if (e.type == 'DOMContentLoaded') {
      adban.processDocument(e.originalTarget);
    }
  };

  const enableDocumentsProcessing = function() {
    logging.info('subscribing to DOMContentLoaded event on gBrowser. state_listener_id=[%s]', state_listener_id);
    gBrowser.addEventListener('DOMContentLoaded', processDocumentEventHandler, true);
  };

  const disableDocumentsProcessing = function() {
    logging.info('unsubscribing from DOMContentLoaded event on gBrowser. state_listener_id=[%s]', state_listener_id);
    gBrowser.removeEventListener('DOMContentLoaded', processDocumentEventHandler, true);
  };

  const onStateChange = function() {
    const cmd_stop = $('adban-cmd-stop');
    const cmd_start = $('adban-cmd-start');
    const toolbarbutton = $('adban-toolbarbutton');
    if (adban.isActive()) {
      cmd_stop.removeAttribute('disabled');
      cmd_start.setAttribute('disabled', 'true');
      if (toolbarbutton) {
        toolbarbutton.removeAttribute('adban-disabled');
      }
      enableDocumentsProcessing();
    }
    else {
      cmd_stop.setAttribute('disabled', 'true');
      cmd_start.removeAttribute('disabled');
      if (toolbarbutton) {
        toolbarbutton.setAttribute('adban-disabled', 'true');
      }
      disableDocumentsProcessing();
    }
  };

  const onMenuPopup = function() {
    const cmd_complaint = $('adban-cmd-complaint');
    if (adban.isActive()) {
      cmd_complaint.removeAttribute('disabled');
    }
    else {
      cmd_complaint.setAttribute('disabled', 'true');
    }

    const cmd_add_per_site_whitelist = $('adban-cmd-add-per-site-whitelist');
    const cmd_remove_per_site_whitelist = $('adban-cmd-remove-per-site-whitelist');
    const current_site_url = getCurrentSiteUrl();
    const current_site_url_without_scheme = getUrlWithoutScheme(current_site_url);
    cmd_add_per_site_whitelist.setAttribute('label', _('add-per-site-whitelist', [current_site_url_without_scheme]));
    cmd_remove_per_site_whitelist.setAttribute('label', _('remove-per-site-whitelist', [current_site_url_without_scheme]));
    const has_per_site_whitelist = adban.hasPerSiteWhitelist(current_site_url);
    if (has_per_site_whitelist == null) {
      cmd_add_per_site_whitelist.setAttribute('disabled', 'true');
      cmd_remove_per_site_whitelist.setAttribute('disabled', 'true');
      cmd_complaint.setAttribute('disabled', 'true');
    }
    else if (has_per_site_whitelist) {
      cmd_add_per_site_whitelist.setAttribute('disabled', 'true');
      cmd_remove_per_site_whitelist.removeAttribute('disabled');
      cmd_complaint.setAttribute('disabled', 'true');
    }
    else {
      cmd_add_per_site_whitelist.removeAttribute('disabled');
      cmd_remove_per_site_whitelist.setAttribute('disabled', 'true');
    }
  };

  const cmdComplaint = function() {
    const referer_url = (content && content.document) ? content.document.referrer : '';
    const complaint_callback = function(site_url, comment) {
      const success_callback = function() {
        conditionalAlert('complaint-sent', _('complaint-sent', [site_url]));
      };
      const failure_callback = function(error) {
        conditionalAlert('complaint-send-error', _('complaint-send-error', [site_url, error]));
      };
      adban.sendUrlComplaint(site_url, referer_url, comment, success_callback, failure_callback);
    };

    // Don't use $('urlbar').value as initial_site_url, since this value can be broken.
    // For example, Chrome likes cutting url scheme, while Opera 11 cuts query parameters
    // from the urlbar.
    const initial_site_url = gBrowser.currentURI.spec;
    const complaint_window = openDialog('chrome://adban/content/report-ads-dialog.xul',
        'adban-complaint-window', '', complaint_callback, initial_site_url);
    complaint_window.focus();
  };

  const cmdStop = function() {
    adban.stop();
    conditionalAlert('adban-stopped', _('adban-stopped'));
  };

  const cmdStart = function() {
    adban.start();
    conditionalAlert('adban-started', _('adban-started'));
  };

  const cmdAddPerSiteWhitelist = function() {
    const current_site_url = getCurrentSiteUrl();
    adban.addPerSiteWhitelist(current_site_url);
    const current_site_url_without_scheme = getUrlWithoutScheme(current_site_url);
    conditionalAlert('per-site-whitelist-added', _('per-site-whitelist-added', [current_site_url_without_scheme]));
  };

  const cmdRemovePerSiteWhitelist = function() {
    const current_site_url = getCurrentSiteUrl();
    adban.removePerSiteWhitelist(current_site_url);
    const current_site_url_without_scheme = getUrlWithoutScheme(current_site_url);
    conditionalAlert('per-site-whitelist-removed', _('per-site-whitelist-removed', [current_site_url_without_scheme]));
  };

  const cmdHelp = function() {
    adban.openTab('help', adban.HELP_URL);
  };

  const cmdDonate = function() {
    adban.openTab('donate', adban.DONATE_URL);
  };

  let cmdRecommend = function() {
    adban.openTab('recommend', adban.RECOMMEND_URL);
  };

  const cmdReportBug = function() {
    adban.openTab('report-bug', adban.REPORT_BUG_URL);
  };

  let state_listener_id;
  let is_initially_active;

  const init = function() {
    logging.info('initializing browser-overlay');
    window.removeEventListener('load', init, false);

    $('adban-cmd-complaint').addEventListener('command', cmdComplaint, false);
    $('adban-cmd-stop').addEventListener('command', cmdStop, false);
    $('adban-cmd-start').addEventListener('command', cmdStart, false);
    $('adban-cmd-add-per-site-whitelist').addEventListener('command', cmdAddPerSiteWhitelist, false);
    $('adban-cmd-remove-per-site-whitelist').addEventListener('command', cmdRemovePerSiteWhitelist, false);
    $('adban-cmd-help').addEventListener('command', cmdHelp, false);
    $('adban-cmd-donate').addEventListener('command', cmdDonate, false);
    $('adban-cmd-recommend').addEventListener('command', cmdRecommend, false);
    $('adban-cmd-report-bug').addEventListener('command', cmdReportBug, false);

    const state_change_results = adban.subscribeToStateChange(onStateChange);
    state_listener_id = state_change_results[0];
    is_initially_active = state_change_results[1];

    // defer first run verification due to FF bug, which prevents from
    // toolbar updating immediately in the window.onload event handler.
    // Read more at http://blog.pearlcrescent.com/archives/24 .
    const first_run_callback = function() {
      if (!pref_branch.prefHasUserValue('first-run')) {
        logging.info('first run of AdvertBan');
        adban.firstRun();
        setupToolbarButtons();
        pref_branch.setBoolPref('first-run', true);
        pref_branch.setBoolPref('toolbarbutton-installed', true);

        // open help page only after a delay, otherwise it won't
        // be opened under FF3.6 due to unknown reason.
        setTimeout(cmdHelp, 2000);
      }
      else if (!pref_branch.prefHasUserValue('toolbarbutton-installed')) {
        logging.info('installing adban-toolbarbutton for the user of the previous AdvertBan version');
        setupToolbarButtons();
        pref_branch.setBoolPref('toolbarbutton-installed', true);
      }

      $('adban-menupopup').addEventListener('popupshowing', onMenuPopup, false);
      if ($('adban-toolbarbutton')) {
        $('adban-toolbarbutton-menupopup').addEventListener('popupshowing', onMenuPopup, false);
      }

      onStateChange(is_initially_active);
    };
    adban.executeDeferred(first_run_callback);

    window.addEventListener('unload', shutdown, false);
    logging.info('browser-overlay has been initialized. state_listener_id=[%s]', state_listener_id);
  };

  const shutdown = function() {
    logging.info('shutting down browser-overlay. state_listener_id=[%s]', state_listener_id);
    window.removeEventListener('unload', shutdown, false);

    if (adban.isActive()) {
      disableDocumentsProcessing();
    }

    adban.unsubscribeFromStateChange(state_listener_id);

    $('adban-menupopup').removeEventListener('popupshowing', onMenuPopup, false);
    if ($('adban-toolbarbutton')) {
      $('adban-toolbarbutton-menupopup').removeEventListener('popupshowing', onMenuPopup, false);
    }

    $('adban-cmd-complaint').removeEventListener('command', cmdComplaint, false);
    $('adban-cmd-stop').removeEventListener('command', cmdStop, false);
    $('adban-cmd-start').removeEventListener('command', cmdStart, false);
    $('adban-cmd-add-per-site-whitelist').removeEventListener('command', cmdAddPerSiteWhitelist, false);
    $('adban-cmd-remove-per-site-whitelist').removeEventListener('command', cmdRemovePerSiteWhitelist, false);
    $('adban-cmd-help').removeEventListener('command', cmdHelp, false);
    $('adban-cmd-donate').removeEventListener('command', cmdDonate, false);
    $('adban-cmd-recommend').removeEventListener('command', cmdRecommend, false);
    $('adban-cmd-report-bug').removeEventListener('command', cmdReportBug, false);

    logging.info('browser-overlay has been shut down. state_listener_id=[%s]', state_listener_id);
  };

  window.addEventListener('load', init, false);
})();

