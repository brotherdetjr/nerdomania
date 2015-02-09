var pongular = require('pongular').pongular;
var EventEmitter = require('events').EventEmitter;

module.exports = pongular
.module('app')
.factory('progressStateFactory', [
'schedulingService', 'redisDao',
function(schedulingService, redisDao) {

return function(userKey, progKey) {
	var emitter = new EventEmitter();

	return Object.create({
		setValue: function(value, cb) {
			this.setValueAt(value, Date.now(), cb);
		},

		stop: function(cb) {
			var self = this;
			var now = Date.now();
			self.unschedule(function() {
				self.getValueAt(now, function(err, value) {
					self.setStateToStopped(function() {
						self.setValueAt(value, now, function() {
							if (cb != null) {
								cb(null, value);
							}
						});
					});
				});
			});
		},

		on: function(event, listener) {
			emitter.on(event, listener);
			return this;
		},

		start: function() {
			var self = this;
			self.getCheckpointProgressAndFullTime(function(err, result) {
				var eta = Math.round((100 - result.checkpointProgress) / 100 * result.fullTime);
				self.startAt(result.checkpointProgress, eta);
			});
		},

		removeListener: function(event, listener) {
			emitter.removeListener(event, listener);
			return this;
		},

		/////////////
		// private //
		/////////////

		getCheckpointProgressAndFullTime: function(cb) {
			var self = this;
			redisDao.hgetNum(userKey, progKey + ':id', function(err, progId) {
				if (!progId) {
					redisDao.hmget(userKey,
						progKey + ':checkpoint:progress',
						progKey + ':fullTime',
						function(err, results) {
							cb(null, {
								checkpointProgress: self.limitProgress(Number(results[0])),
								fullTime: Number(results[1])
							});
						}
					);
				}
			});
		},

		startAt: function(progress, eta) {
			redisDao.hmset(userKey,
				progKey + ':id', this.scheduleFinish(eta),
				progKey + ':eta', eta,
				progKey + ':checkpoint:timestamp', Date.now(),
				function() {
					emitter.emit('update', {progress: progress, eta: eta, state: 'running'});
				}
			);
		},

		limitProgress: function(value) {
			if (value > 100) {
				value = 100;
			} else if (value < 0) {
				value = 0;
			}
			return value;
		},

		scheduleFinish: function(eta) {
			var self = this;
			return schedulingService.schedule(function() {
				self.setStateToStopped(function() {
					self.setValue(100);
				});
			}, eta);
		},

		setStateToStopped: function(cb) {
			redisDao.hmset(userKey,
				progKey + ':id', 0,
				progKey + ':eta', 0,
				cb
			);
		},

		setValueAt: function(value, timestamp, cb) {
			redisDao.multi()
				.hmset(userKey,
					progKey + ':checkpoint:timestamp', timestamp,
					progKey + ':checkpoint:progress', value)
				.hget(userKey, progKey + ':eta')
				.exec(function(err, results) {
					var eta = Number(results[1]);
					var result = {progress: value, state: eta ? 'running' : 'stopped'};
					if (eta) {
						result.eta = eta;
					}
					if (cb != null) {
						cb(null, result);
					}
					emitter.emit('update', result);
				});
		},

		unschedule: function(cb) {
			redisDao.hgetNum(userKey, progKey + ':id', function(err, progId) {
				if (progId) {
					schedulingService.unschedule(progId);
					cb(null, progId);
				}
			});
		},

		getValueAt: function(timestamp, cb) {
			var self = this;
			redisDao.hmget(userKey,
				progKey + ':checkpoint:progress',
				progKey + ':checkpoint:timestamp',
				progKey + ':fullTime',
				progKey + ':eta',
				function(err, results) {
					var checkpointProgress = Number(results[0]);
					var checkpointTimestamp = Number(results[1]);
					var fullTime = Number(results[2]);
					var eta = Number(results[3]);
					var progress = eta ?
						(timestamp - checkpointTimestamp) / fullTime * 100 + checkpointProgress :
						checkpointProgress;
					cb(null, self.limitProgress(progress));
				});
		}
	});
};

}]);
