var pongular = require('pongular').pongular;

module.exports = pongular
.module('service.victim', ['dao.redis'])
.service('victimService', ['redisDao', function(redisDao) {
	var normalRandom = function() {
		var x, y, s;
		do {
			x = Math.random() * 2 - 1;
			y = Math.random() * 2 - 1;
			s = x * x + y * y;
		} while (s == 0 || s > 1);
		return x * Math.sqrt(-2 * Math.log(s) / s);
	};

	var round2 = function(num) {
		return Math.round(num * 100) / 100;
	};

	var randomLevel = function(baseLevel) {
		var result = baseLevel + Math.round(normalRandom());
		result = Math.max(result, 1);
		return result;
	};

	var randomIp = function() {
		var getOctet = function() {
			return Math.round(Math.random() * 255);
		};
		return getOctet() + '.' + getOctet() + '.' + getOctet() + '.' + getOctet();
	};

	var newVictim = function(ip, baseLevel) {
		return {
			ip: ip,
			firewallLevel: randomLevel(baseLevel),
			antivirusLevel: randomLevel(baseLevel),
			passwordLevel: randomLevel(baseLevel),
			account: Math.abs(round2(normalRandom() * 250 + 500))
		};
	};

	var save = function(victim, callback) {
		redisDao.hmset('victims:' + victim.ip,
			'firewallLevel', victim.firewallLevel,
			'antivirusLevel', victim.antivirusLevel,
			'passwordLevel', victim.passwordLevel,
			'account', victim.account,
			callback);
	};

	var generateSingle;
	generateSingle = function(level, cb) {
		var ip = randomIp();
		redisDao.exists(ip, function(err, value) {
			if (1 == value) {
				generateSingle(level, cb);
			} else {
				cb(null, newVictim(ip, level));
			}
		});
	};

	this.generate = function(qty, level, cb) {
		var results = [];
		for (var i = 0; i < qty; i++) {
			generateSingle(level, function(err, victim) {
				save(victim, function() {
					results.push(victim);
					if (results.length == qty) {
						cb(null, results);
					}
				});
			});
		}
	};

	this.remove = function(ips, callback) {
		if (!(ips instanceof Array)) {
			ips = [ips];
		}
		if (ips.length > 0) {
			redisDao.del(ips.map(function(ip) { return 'victims' + ':' + ip; }), callback);
		} else {
			callback(null, 0);
		}
	};

	this.getVictims = function(ips, cb) {
		var multi = redisDao.multi();
		ips.forEach(function(ip) {
			multi.hmget('victims:' + ip, 'firewallLevel', 'antivirusLevel', 'passwordLevel');
		});
		var n = 0;
		multi.exec(function(err, results) {
			cb(null, results.map(function(e) {
				return {
					ip: ips[n++],
					firewallLevel: e[0],
					antivirusLevel: e[1],
					passwordLevel: e[2]
				};
			}));
		});
	};

}]);
