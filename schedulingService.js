var pongular = require('pongular').pongular;

module.exports = pongular
.module('app')
.service('schedulingService', function() {
	var timeouts = {};
	var timeoutsCounter = 1;

	this.schedule = function(callback, delay) {
		var current = timeoutsCounter++;
		timeouts[current] = setTimeout(function() {
			timeouts[current] = null;
			callback();
		}, delay);
		return current;
	};

	this.unschedule = function(id) {
		clearTimeout(timeouts[id]);
		delete timeouts[id];
	};
});
