var mainModule = angular.module('main', []);


mainModule.controller('MainCtrl', ['$scope', '$interval', function($scope, $interval) {
	var socket = io();
	var itJobPrice = 10; // TODO: retrieve from server

	$scope.value = 'sisechki';
	$scope.itJobClicks = 0;
	$scope.account = 0;

	$scope.scanButtonClick = function() {
		alert('jopu sebe proskaniruy!');
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
if (value == null) {
	alert('VALUE: ' + value);
}
		if (value > $scope.account || $scope.itJobClicks == 0) {
			$scope.account = value;
		}
	});
}]);

