var locks = [
	{resources: ['a:y'], blocks: []},
	{resources: ['d'], blocks: []},
	{resources: ['a:x', 'b'], blocks: []},
	{resources: ['z:a', 'a:z', 'g'], blocks: []}
];

var waiting = [];

var relate = function(resource1, resource2) {
	var r1 = resource1 + ':', r2 = resource2 + ':';
	return r1.indexOf(r2) == 0 || r2.indexOf(r1) == 0;
};

var block = function(resources1, resources2) {
	var i, j;
	for (i = 0; i < resources1.length; i++) {
		for (j = 0; j < resources2.length; j++) {
			if (relate(resources1[i], resources2[j])) {
				return true;
			}
		}
	}
	return false;
};

var acquire = function() {
	var args = [].slice.call(arguments);
	args = args.slice(0, args.length - 1).sort();
	locks.forEach(function(lock) {
		if (block(lock.resources, args)) {
			
		}
	});
//	process.nextTick(arguments[arguments.length - 1]);
	console.log('HOHOHO: %j', args);
};

acquire('a','c','b', function(err, value) {
	console.log('acquired!');
});



/*console.log(relate('a:b', 'a'));
console.log(relate('a', 'a:b'));
console.log(relate('a:c', 'a:b'));
console.log(relate('a:b', 'a:c'));
console.log(relate('a:c', 'a:cc'));
console.log(relate('a:cc', 'a:c'));
*/

/*console.log(block(['a', 'b', 'c'], ['d', 'e']));
console.log(block(['a', 'b', 'c'], ['a', 'e']));
console.log(block(['a:x', 'b', 'c'], ['a', 'e']));
console.log(block([], []));*/

