var mainModule = angular.module('main', ['ui.bootstrap']);

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

mainModule.directive('clickOutside', ['$document', '$filter', function($document, $filter) {
	return {
		restrict: 'A',
		link: function(scope, elem, attr, ctrl) {
			elem.bind('click', function(e) {
				e.stopPropagation();
			});
			var handler = function(event) {
				scope.$apply(attr.clickOutside);
			};
			elem.on('$destroy', function() {
				$document.unbind('click', handler);
			});
			$document.bind('click', handler);
		}
	}
}]);

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
	$scope.candidateToRemove = null;

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
		if ($scope.candidateToRemove == ip) {
			socket.emit('removeFromHacking', $scope.candidateToRemove);
			$scope.candidateToRemove = null;
		} else {
			$scope.candidateToRemove = ip;
		}
	};

	$scope.hackingStartStopButtonClick = function(hack) {
		if (hack.state == 'stopped') {
			socket.emit('startHacking', hack.ip);
		} else if (hack.state == 'running') {
			socket.emit('stopHacking', hack.ip);
		}
	};

	$scope.outsideRemoveFromHackingButtonClick = function() {
		$scope.candidateToRemove = null;
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

	// TODO refactoring
	var setHackingProgress = function(value) {
		var victim = $.grep($scope.hacking, function(e) { return e.ip == value.ip; })[0];
		var stage = victim[value.stage];
		stage.progress = value.progress;
		stage.state = value.state;
		if (value.state == 'running') {
			var delta = (100 - stage.progress) / fps / value.eta * 1000;
			stage.promise = $interval(function() {
				if (stage.progress >= 100) {
					victim.state = 'stopped';
					$interval.cancel(stage.promise);
					stage.promise = null;
				} else {
					stage.progress += delta;
				}
			}, 1000 / fps);
		} else if (stage.promise != null) {
			$interval.cancel(stage.promise);
			stage.promise = null;
		}
		victim.state = 'stopped';
		for (var propName in victim) {
			if (propName != 'ip' && propName != 'state') {
				var curStage = victim[propName];
				if (curStage.state == 'running') {
					victim.state = 'running';
				}
			}
		}
	};

	socket.on('scan', function(value) {
		setScanProgress(value);
	});

	socket.on('hacking', function(value) {
		setHackingProgress(value);
	});

	socket.on('scanResults', function(value) {
		$scope.scanResults = value;
	});

	socket.on('movedToHacking', function(ip) {
		var v = $scope.scanResults.filter(function(e) { return e.ip == ip; })[0];
		$scope.hacking.push({
			ip: ip,
			state: 'stopped',
			firewall: {
				progress: 0,
				level: v.firewallLevel
			},
			antivirus: {
				progress: 0,
				level: v.antivirusLevel
			},
			password: {
				progress: 0,
				level: v.passwordLevel
			},
			transfer: {
				progress: 0
			}
		});
		$scope.scanResults = $scope.scanResults.filter(function(e) { return e.ip != ip; });
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
		// TODO make it not so awful
		for (var i = 0; i < $scope.hacking.length; i++) {
			var victim = $scope.hacking[i];
			for (var propName in $scope.hacking[i]) {
				if (propName != 'ip' && propName != 'state') {
					var stage = victim[propName];
					setHackingProgress({
						ip: victim.ip,
						state: stage.eta != 0 ? 'running' : 'stopped',
						stage: propName,
						progress: stage.progress,
						eta: stage.eta
					});
				}
			}
		}
		setScanProgress(state.scanProgress);
	});
}]);

