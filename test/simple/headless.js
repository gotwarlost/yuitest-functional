/*globals phantom */
var page = require('webpage').create(),
    fs = require('fs');

page.onConsoleMessage = function (msg, lineNum, sourceId) {
    console.log('CONSOLE: ' + msg);
};

page.onCallback = function (data) {
    fs.write('results.xml', data.results, 'w');
    fs.write('coverage.json', JSON.stringify(data.coverage, undefined, 4), 'w');
    phantom.exit(0);
};

page.onError = function (ex) {
    console.log('Unexpected error running page');
    console.log(ex.message || String(ex));
    phantom.exit(1);
};

page.open('./test.html', function (status) {
    console.log('Status: ' + status);
});



