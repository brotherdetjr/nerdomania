var mainModule = angular.module('main', []);


mainModule.controller('MainCtrl', ['$scope', '$interval', function($scope, $interval) {
	var fps = 20;
	var socket = io();
	var itJobPrice = 10; // TODO: retrieve from server

	$scope.value = 'sisechki';
	$scope.itJobClicks = 0;
	$scope.account = 0;
	$scope.scanResults = [];
	$scope.scanProgress = 0;
	$scope.scanState = 'stopped';
	$scope.scanPromise = null;

	$scope.scanButtonClick = function() {
		socket.emit('scan');
	};

	$scope.itJobButtonClick = function() {
		$scope.itJobClicks++;
		$scope.account += itJobPrice;
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

	socket.on('scan', function(value) {
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
	});

	socket.on('scanResults', function(value) {
		$scope.scanResults = value;
	});
}]);

