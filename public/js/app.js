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
	$scope.scanning = false;

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

	socket.on('scan', function(value) {
		$scope.scanProgress = value.progress;
		if (value.eta != null) {
			$scope.scanning = true;
			var delta = (100 - $scope.scanProgress) / fps / value.eta * 1000;
			var promise = $interval(function() {
				if ($scope.scanProgress >= 100) {
					$scope.scanning = false;
					$interval.cancel(promise);
				} else {
					$scope.scanProgress += delta;
				}
			}, 1000 / fps);
		} else {
			$scope.scanning = false;
		}
	});

	socket.on('scanResults', function(value) {
		$scope.scanResults = value;
	});
}]);

