var mainModule = angular.module('main', []);

mainModule.factory('socket', function ($rootScope) {
	var socket = io();
	return {
		on: function (eventName, callback) {
			socket.on(eventName, function () {
				var args = arguments;
				$rootScope.$apply(function () {
					callback.apply(socket, args);
				});
			});
		},
		emit: function (eventName, data, callback) {
			socket.emit(eventName, data, function () {
				var args = arguments;
				$rootScope.$apply(function () {
					if (callback) {
						callback.apply(socket, args);
					}
				});
			})
		}
	};
});

mainModule.controller('MainCtrl', ['$scope', '$interval', 'socket', function($scope, $interval, socket) {
	var fps = 20;
	var itJobPrice = 10; // TODO: retrieve from server

	$scope.itJobClicks = 0;
	$scope.account = 0;
	$scope.scanResults = [];
	$scope.scanProgress = 0;
	$scope.scanState = 'stopped';
	$scope.scanPromise = null;
	$scope.hacking = [];

	$scope.scanButtonClick = function() {
		socket.emit('scan');
	};

	$scope.itJobButtonClick = function() {
		$scope.itJobClicks++;
		$scope.account += itJobPrice;
	};

	$scope.scannedIpClick = function(ip) {
		socket.emit('moveToHacking', ip);
	};

	$scope.removeFromHackingButtonClick = function(ip) {
		socket.emit('removeFromHacking', ip);
	};

	$interval(function() {
		var dec = 5;
		if ($scope.itJobClicks < dec) {
			dec = $scope.itJobClicks;
		}
		$scope.itJobClicks -= dec;
		if (dec > 0) {
			socket.emit('itJobs', dec);
		}
	}, 1000);

	socket.on('account', function(value) {
		if (value > $scope.account || $scope.itJobClicks == 0) {
			$scope.account = value;
		}
	});

	var cancelScanPromise = function() {
		$interval.cancel($scope.scanPromise);
		$scope.scanPromise = null;
	};

	var setScanProgress = function(value) {
		$scope.scanProgress = value.progress;
		$scope.scanState = value.state;
		if (value.state == 'running') {
			var delta = (100 - $scope.scanProgress) / fps / value.eta * 1000;
			$scope.scanPromise = $interval(function() {
				if ($scope.scanProgress >= 100) {
					$scope.scanState = 'stopped';
					cancelScanPromise();
				} else {
					$scope.scanProgress += delta;
				}
			}, 1000 / fps);
		} else if ($scope.scanPromise != null) {
			cancelScanPromise();
		}
	};

	socket.on('scan', function(value) {
		setScanProgress(value);
	});

	socket.on('scanResults', function(value) {
		$scope.scanResults = value;
	});

	socket.on('movedToHacking', function(ip) {
		$scope.hacking.push({
			ip: ip,
			state: 'stopped',
			firewall: {
				progress: 0,
				eta: 0
			},
			antivirus: {
				progress: 0,
				eta: 0
			},
			password: {
				progress: 0,
				eta: 0
			},
			transfer: {
				progress: 0,
				eta: 0
			}
		});
		$scope.scanResults = $scope.scanResults.filter(function(e) {
			return e.ip != ip;
		});
	});

	socket.on('removedFromHacking', function(ip) {
		$scope.hacking = $scope.hacking.filter(function(e) {
			return e.ip != ip;
		});
	});

	socket.on('mainState', function(state) {
		$scope.account = state.account;
		$scope.scanResults = state.scanResults;
		$scope.hacking = state.hacking;
		setScanProgress(state.scanProgress);
	});
}]);

