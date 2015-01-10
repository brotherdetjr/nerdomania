var pongular = require('pongular').pongular;

module.exports = pongular
.module('app')
.service('redisDao', ['redisClient', function(redisClient) {
	var crashing = function(callback, converter, nullable) {
		if (callback == null) {
			callback = function() {};
		}
		return function(err, reply) {
			if (err || !nullable && reply == null) {
				console.log(new Error(err).stack);
				process.exit(1);
			}
			callback(null, converter ? converter(reply) : reply);
		};
	};

	var crashingNum = function(callback) {
		return crashing(callback, function(reply) { return Number(reply); });
	};

	var crashingBool = function(callback) {
		return crashing(callback, function(reply) { return reply == 1; });
	};

	var crashingList = function(callback) {
		return crashing(callback, function(reply) { return reply == null ? [] : reply; }, true);
	};

	redisClient.on('error', function (err) {
		console.log(new Error(err).stack);
		process.exit(1);
	});

	var transformCb = function(a) {
		var cb = a[a.length - 1];
		if (cb instanceof Function) {
			var args = [].slice.call(a, 0, a.length - 1);
			return args.concat(crashing(cb));
		} else {
			return a;
		}
	};

	this.hgetNum = function(key, prop, callback) {
		redisClient.hget(key, prop, crashingNum(callback));
	};
	this.hincrbyfloat = function(key, prop, delta, callback) {
		redisClient.hincrbyfloat(key, prop, delta, crashingNum(callback));
	};
	this.lrange = function(key, start, stop, callback) {
		redisClient.lrange(key, start, stop, crashingList(callback));
	};
	this.del = function(keys, callback) {
		redisClient.del(keys, crashingNum(callback));
	};
	this.lrem = function(key, count, sample, callback) {
		redisClient.lrem(key, count, sample, crashingNum(callback));
	};
	this.hset = function(key, field, value, callback) {
		redisClient.hset(keys, field, value, crashingBool(callback));
	};
	this.hmset = function() {
		redisClient.hmset.apply(redisClient, transformCb(arguments));
	};
	this.hmget = function() {
		redisClient.hmget.apply(redisClient, transformCb(arguments));
	};
	this.exists = function(key, callback) {
		redisClient.exists(key, crashingBool(callback));
	};
	this.rpush = function() {
		redisClient.rpush.apply(redisClient, transformCb(arguments));
	};

	this.multi = function() {
		var redisMulti = redisClient.multi();
		var multi;
		multi = {
			rpush: function() {
				redisMulti.rpush.apply(redisMulti, arguments); return multi;
			},
			hmset: function() {
				redisMulti.hmset.apply(redisMulti, arguments); return multi;
			},
			hmget: function() {
				redisMulti.hmget.apply(redisMulti, arguments); return multi;
			},
			hset: function() {
				redisMulti.hset.apply(redisMulti, arguments); return multi;
			},
			hget: function() {
				redisMulti.hget.apply(redisMulti, arguments); return multi;
			},
			hincrbyfloat: function() {
				redisMulti.hincrbyfloat.apply(redisMulti, arguments); return multi;
			},
			lrem: function() {
				redisMulti.lrem.apply(redisMulti, arguments); return multi;
			},
			del: function() {
				redisMulti.del.apply(redisMulti, arguments); return multi;
			},
			exec: function(callback) {
				redisMulti.exec(crashing(callback, function(results) { return results; }));
			}
		};
		return multi;
	};

}]);
