var dgram      = require('dgram')
  , sys        = require('sys')
  , net        = require('net')
  , config     = require('./config')
  , base64     = require('base64')
  , https      = require('https');


var counters = {};
var timers = {};
var debugInt, flushInt, server;

config.configFile(process.argv[2], function (config, oldConfig) {
  if (! config.debug && debugInt) {
    clearInterval(debugInt); 
    debugInt = false;
  }

  if (config.debug) {
    if (debugInt !== undefined) { clearInterval(debugInt); }
    debugInt = setInterval(function () { 
      sys.log("Counters:\n" + sys.inspect(counters) + "\nTimers:\n" + sys.inspect(timers));
    }, config.debugInterval || 10000);
  }

  if (server === undefined) {
    server = dgram.createSocket('udp4', function (msg, rinfo) {
      if (config.dumpMessages) { sys.log(msg.toString()); }
      var bits = msg.toString().split(':');
      var key = bits.shift()
                    .replace(/\s+/g, '_')
                    .replace(/\.\//g, '-')
                    .replace(/[^a-zA-Z_\-0-9]/g, '');

      if (bits.length == 0) {
        bits.push("1");
      }

      for (var i = 0; i < bits.length; i++) {
        var sampleRate = 1;
        var fields = bits[i].split("|");
        if (fields[1] === undefined) {
            sys.log('Bad line: ' + fields);
            continue;
        }
        if (fields[1].trim() == "ms") {
          if (! timers[key]) {
            timers[key] = [];
          }
          timers[key].push(Number(fields[0] || 0));
        } else {
          if (fields[2] && fields[2].match(/^@([\d\.]+)/)) {
            sampleRate = Number(fields[2].match(/^@([\d\.]+)/)[1]);
          }
          if (! counters[key]) {
            counters[key] = 0;
          }
          counters[key] += Number(fields[0] || 1) * (1 / sampleRate);
        }
      }
    });

    server.bind(config.port || 8125);

    var flushInterval = Number(config.flushInterval || 10000);

    flushInt = setInterval(function () {
      var stats = {};
      stats["gauges"] = {};
      stats["counters"] = {};
      var ts = Math.round(new Date().getTime() / 1000);
      var numStats = 0;
      var key;

      for (key in counters) {
        var value = counters[key] / (flushInterval / 1000);
        stats["counters"][key] = {};
        stats["counters"][key]["value"] = value;

        counters[key] = 0;

        numStats += 1;
      }

      for (key in timers) {
        if (timers[key].length > 0) {
          var values = timers[key].sort(function (a,b) { return a-b; });
          var count = values.length;
          var min = values[0];
          var max = values[count - 1];

          var sum = 0;
          var sumOfSquares = 0;
          for (var i = 0; i < count; i++) {
            sum += values[i];
            sumOfSquares += values[i] * values[i];
          }

          timers[key] = [];
          stats["gauges"][key] = {};
          stats["gauges"][key]["count"] = count;
          stats["gauges"][key]["sum_squares"] = sumOfSquares;
          stats["gauges"][key]["sum"] = sum;
          stats["gauges"][key]["min"] = min;
          stats["gauges"][key]["max"] = max;

          numStats += 1;
        }
      }

      stats["counters"]["numStats"] = {};
      stats["counters"]["numStats"]["value"] = numStats;

      var stats_str = JSON.stringify(stats);
      sys.puts(stats_str);
      sys.puts(stats_str.length);


      var options = {
        host: 'metrics-api.librato.com',
        port: 443,
        path: '/v1/metrics.json',
        method: 'POST',
        headers: {
          "Authorization": 'Basic ' + base64.encode(new Buffer(config.libratoUser + ':' + config.libratoApiKey)),
          "Content-Length": stats_str.length,
          "Content-Type": "application/json"
        }
      };

      var req = https.request(options, function(res) {
        console.log("statusCode: ", res.statusCode);
        console.log("headers: ", res.headers);
        res.on('data', function(d) {
          sys.puts("Got some data");
          process.stdout.write(d);
        });
      });
      req.write(stats_str);
      req.end();

      req.on('error', function(e) {
        console.error("There was an error");
        console.error(e);
      });

    }, flushInterval);
  }

});

