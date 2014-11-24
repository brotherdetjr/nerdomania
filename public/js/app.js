var mainModule = angular.module('main', []);


mainModule.controller('MainCtrl', ['$scope', '$interval', function($scope, $interval) {
	var socket = io();
	var itJobPrice = 10; // TODO: retrieve from server

	$scope.value = 'sisechki';
	$scope.itJobClicks = 0;
	$scope.account = 0;
	$scope.scanResults = [];
	$scope.scanning = false;
	$scope.scanProgress = 0;

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
		$scope.scanning = value.eta != 0;
		$scope.scanProgress = value.progress;
	});

	socket.on('scanResults', function(value) {
		setTimeout(function() { $scope.scanning = false; }, 1000);
		$scope.scanResults = value;
	});
}]);

