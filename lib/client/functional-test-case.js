/*
 Copyright (c) 2013, Yahoo! Inc.  All rights reserved.
 Copyrights licensed under the New BSD License. See the accompanying LICENSE file for terms.
 */
/*globals YUI */
YUI.add('functional-test-case', function (Y) {

    //an abstract async runner class
    function AbstractRunner() {
    }

    AbstractRunner.prototype = {
        /**
         * runs asynchronously in scope `scope` calling the callback when done
         * @param scope the scope to use for running functions
         * @param callback the callback to call with an optional error when done.
         */
        execute: function (scope, callback) { throw new Error('AbstractRunner:execute - must be implemented'); },
        /**
         * returns the worst-case running time of this runner in milliseconds
         */
        getRuntimeMillis: function () { return 0; }
    };

    // expects a function with arity 0 or 1. When 1, the function is assumed to be async
    // and returned as-is. When 0, the function is assumed to be synchronous and a wrapper function is returned
    // that calls the sync function in its own scope, converting thrown exceptions to async errors.
    function maybeWrap(fn) {
        var deferred = function (callback, ex) {
            Y.later(0, null, callback, [ ex ]);
        };
        if (!(fn && typeof fn === 'function')) {
            throw new Error('Expected a function, found:' + fn);
        }
        if (fn.length > 1) {
            throw new Error('Function :' + fn + ' had arity > 1');
        }
        if (fn.length === 0) {
            return function (callback) {
                try {
                    fn.apply(this);
                    return deferred(callback);
                } catch (ex) {
                    return deferred(callback, ex);
                }
            };
        }
        return function (callback) {
            var tick = true;
            try {
                fn.apply(this, [function (ex) {
                    if (tick) {
                        return deferred(callback, ex);
                    }
                    return callback(ex);
                }]);
                tick = false;
            } catch (ex) {
                return deferred(callback, ex);
            }
        };
    }

    /**
     * Runner that runs a single function
     * @param fn the function to run
     * @param runtimeMillis the expected worst-case runtime in milliseconds for this function
     * @constructor
     */
    function FunctionRunner(fn, runtimeMillis) {
        FunctionRunner.superclass.constructor.call(this);
        this.fn = maybeWrap(fn);
        this.runtimeMillis = runtimeMillis || 10;
    }

    Y.extend(FunctionRunner, AbstractRunner, {
        /**
         * implements `run` by calling the function in correct scope
         */
        execute: function (scope, callback) {
            if (!callback && typeof scope === 'function') {
                callback = scope;
                scope = this;
            }
            return this.fn.call(scope, callback);
        },
        /**
         * returns the worst-case runtime by replaying the constructor arg
         */
        getRuntimeMillis: function () {
            return this.runtimeMillis;
        }
    });
    /**
     * Runner that runs a bunch of AbstractRunner objects in series
     * @param {Object} defaults - default configuration. Optional.
     * @param {number} defaults.timeout - the default timeout in milliseconds for waits
     * @param {number} defaults.shortWait - the default time in milliseconds to wait after mouse clicks etc.
     * @param {number} defaults.poll - the polling interval in milliseconds for tests with wait
     * @constructor
     */
    function Batch(defaults) {
        Batch.superclass.constructor.call(this);
        defaults = defaults || {};
        this.fns = [];
        this.defaults = {
            timeout: defaults.timeout || 10000,
            shortWait: defaults.shortWait || 100,
            poll: defaults.poll || 200
        };
    }

    Y.extend(Batch, AbstractRunner, {
        /**
         * implements `execute` by calling each of its runners in series
         */
        execute: function (scope, callback) {
            var i = -1,
                iteratorCallback,
                fns = this.fns,
                cb = function (err) {
                    if (err) { return callback(err); }
                    i += 1;
                    if (i >= fns.length) {
                        return callback();
                    }
                    return fns[i].execute(scope, iteratorCallback);
                };
            iteratorCallback = cb;
            if (!callback && typeof scope === 'function') {
                callback = scope;
                scope = this;
            }
            cb();
        },
        /**
         * returns the worst-case runtime as a sum of the worst-case runtimes of its children
         */
        getRuntimeMillis: function () {
            var i,
                total = 0;
            for (i = 0; i < this.fns.length; i += 1) {
                total += this.fns[i].getRuntimeMillis();
            }
            return total;
        },
        /**
         * Adds a function or another abstract runner to the list of children, returning `this`
         * so that calls can be chained
         * @param fn the function or AbstractRunner object to add to the children list
         * @param millis the worst case runtime of the function in milliseconds. This argument
         *  is ignored when adding an AbstractRunner instance
         * @returns `this`
         */
        add: function (fn, millis) {
            if (fn instanceof AbstractRunner) {
                this.fns.push(fn);
            } else {
                this.fns.push(new FunctionRunner(fn, millis));
            }
            return this; //make chainable
        },
        /**
         * creates another batch object using the defaults used for this one, unless specifically overridden.
         * Note that there is no other relationship between the objects. If you want to create a
         * batch that is the child of this one, you need to explicitly `add` it
         * @param {Object} defaults - default configuration for the batch created. Optional.
         * @returns {Batch} a Batch object with merged defaults.
         */
        createBatch: function (defaults) {
            return new Batch(Y.merge(this.defaults, defaults || {}));
        }
    });

    /**
     * extends the `Batch` prototype using the supplied generator
     * @param name the method name to add to the prototype
     * @param generator a function that takes any number of arguments and returns a function
     *  or an AbstractRunner that is then added to this batch's children
     */
    Batch.extend = function (name, generator) {
        if (Batch.prototype.hasOwnProperty(name)) {
            throw new Error('Attempt to extend the Batch prototype for an existing method: ' + name);
        }
        if (!(generator && typeof generator === 'function')) {
            throw new Error('Generator for name [' + name + '] must be a function');
        }
        Batch.prototype[name] = function () {
            var args = Array.prototype.slice.call(arguments),
                fn = generator.apply(this, args);
            return this.add(fn);
        };
    };

    Batch.extend('wait', function (millis) {
        millis = millis || this.defaults.timeout;
        return new FunctionRunner(function (cb) {
            Y.later(millis, null, cb);
        }, millis);
    });

    Batch.extend('waitUntil', function (testFn, timeout, pollInterval, timeoutMsg) {
        var timePassed = 0,
            shortWait = this.defaults.shortWait,
            timer,
            endFn = function (cb, err) {
                if (timer) { timer.cancel(); }
                Y.later(shortWait, null, function () { return cb(err); });
            },
            pollFn = function (cb) {
                try {
                    if (testFn()) {
                        return endFn(cb);
                    }
                    timePassed += pollInterval;
                    if (timePassed > timeout) {
                        return endFn(cb, new Error(timeoutMsg || 'Test function did not return true in the allotted time'));
                    }
                } catch (ex) {
                    return endFn(cb, ex);
                }
            };

        if (typeof testFn !== 'function') { throw new Error('waitUntil: Need a test function to execute, found ' + testFn); }
        timeout = timeout || this.defaults.timeout;
        pollInterval = pollInterval || this.defaults.poll;

        return new FunctionRunner(function (cb) {
            timer = Y.later(pollInterval, null, pollFn, cb, true);
        }, timeout);
    });

    function isVisible(node) {
        var domNode = Y.Node.getDOMNode(node);
        if (!domNode) {
            return false;
        }
        return Y.DOM.getComputedStyle(domNode, 'display') !== 'none' && Y.DOM.getComputedStyle(domNode, 'visibility') !== 'hidden';
    }

    Batch.extend('debug', function (str) {
        return function () {
            Y.log(str);
        };
    });

    Batch.extend('waitForElement', function (selector, timeout, pollInterval) {
        var fn = function () {
            var node = Y.one(selector);
            return node && isVisible(node);
        };
        return this.createBatch().waitUntil(fn, timeout, pollInterval, 'Could not find node [' + selector + '] in the allotted time');
    });

    Batch.extend('click', function (selector) {
        return this.createBatch()
            .add(function () {
                var node = Y.one(selector);
                if (!node) { throw new Error('Unable to find node with selector: ' + selector); }
                try {
                    node.simulate('mousedown');
                    node.simulate('mouseup');
                    node.simulate('click');
                } catch (ex) {} //swallow
            })
            .wait(this.defaults.shortWait);
    });

    Batch.extend('setValue', function (selector, value) {
        return this.createBatch()
            .add(function () {
                var node = Y.one(selector);
                if (!node) { throw new Error('Unable to find node with selector: ' + selector); }
                //make this more fancy to detect input type and set value appropriately
                try {
                    node.simulate('focus');
                } catch (ex) {} //swallow
                node.set('value', value);
                //trigger any events associated with key presses
                try {
                    node.simulate('keydown', { keyCode: 32 });
                    node.simulate('keyup', { keyCode: 32 });
                    node.simulate('keypress', { charCode: 32 });
                } catch (ex2) {}
            })
            .wait(this.defaults.shortWait);
    });

    Batch.extend('waitAndClick', function (selector, timeout) {
        return this.createBatch()
            .waitForElement(selector, timeout)
            .click(selector);
    });
    /**
     * A top-level batch that is associated with a test and has a `run` method
     * @param test the test to which this batch is associated
     * @param defaults - the default batch configuration
     * @constructor
     */
    function TestBatch(test, defaults) {
        this.test = test;
        TestBatch.superclass.constructor.call(this, defaults);
    }

    Y.extend(TestBatch, Batch, {
        /**
         * runs this batch asynchronously using the `wait` and `resume` methods of its
         * associated test.
         */
        run: function () {
            var test = this.test,
                timeout = this.getRuntimeMillis(),
                callback = function (err) {
                    test.resume(function () {
                        if (err) {
                            var msg = err.message || String(err);
                            if (typeof err === 'object') {
                                if (err.hasOwnProperty('expected')) {
                                    msg += '\nExpected: ' + err.expected + ' (' + typeof err.expected + ')';
                                }
                                if (err.hasOwnProperty('actual')) {
                                    msg += '\nActual: ' + err.actual + ' (' + typeof err.actual + ')';
                                }
                            }
                            Y.Assert.fail(msg);
                        }
                    });
                };

            this.execute(test, callback);
            test.wait(timeout);
        }
    });

    var FCase = Y.Test.FunctionalTestCase = function () {
        FCase.superclass.constructor.apply(this, arguments);
    };

    FCase.Batch = Batch;

    Y.extend(FCase, Y.Test.Case, {
        /**
         * returns a batch that can be run for the test
         * @param defaults
         * @returns {TestBatch}
         */
        batch: function (defaults) {
            return new TestBatch(this, defaults);
        }
    });

}, "0.1", { requires: [ "test", "dom", "node", "node-event-simulate" ]});

