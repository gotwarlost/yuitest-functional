yuitest-functional
==================

A `Y.Test.Case` subclass useful for functional tests, typically with `arrow`.

Problem
-------

Functional tests require a lot of waiting around in multiple steps of a single scenario. This can quickly get cumbersome
when using `yuitest` because of all the nested `wait` and `resume` calls riddled with custom timeouts that do not scale
from a maintenance viewpoint.

Also, functional tests require some semblance of sanity with respect to how input events are simulated. This module aims
to address this issue as well with a set of functions that can help with consistent simulation of inputs and a cleaner
abstract API for this.

Solution
--------

Think of every functional test as an asynchronous, callback-driven test that has exactly one `wait` and
`resume`. The meat of the test case executes a series of asynchronous functions chained together with callbacks
in the manner of `async.series`. The timeout for the test case is automatically calculated as the sum
of the worst-case timeouts for every individual step.

A simple example
----------------

```javascript
/*globals YUI */
YUI.add("my-functional-test-module", function (Y) {
    Y.Test.Runner.add(new Y.Test.FunctionalTestCase({
        "should test an ajax page with appropriate waits": function () {
            // assuming we are running on the page that is loaded
            // run a bunch of stuff in order and perform some assertions at the end
            this.batch().
                // write to console log
                debug('Starting test').
                // wait for an element to show up and be visible in the DOM, and click it
                waitAndClick('#start-button').
                // now wait for a secondary element to show up
                waitForElement("#overlay").
                // fill in some fields
                setValue("#overlay-title", "Foo bar").
                setValue("#overlay-description", "My giant foobar").
                // submit the data
                click("#overlay-save").
                // wait for form to be posted for a fixed amount of time
                wait(2000).
                // now assert the state of the page using an arbitrary function
                // note that this synchronous function with arity 0 is
                // automatically turned into an async function
                add(function assertions() {
                    Y.Assert.areEqual("Foo bar", Y.one("ul.list li .name").get("innerHTML"));
                    Y.Assert.areEqual("My giant foobar", Y.one("ul.list li.desc").get("innerHTML"));
                }).
                run();
            // note that there should be no code beyond this point since the above is executed
            // asynchronously and code here will immediately execute before the prior steps
            // are complete
        }
    }));
}, "0.1", {requires: [ "functional-test-case" ]});
```

Under the covers
----------------

Every sugar function found under `this.batch()` is a generator that returns a function accepting a single callback. The
returned function also has a `timeout` attribute that represents the worst-case timeout of the step. The `run` method
accumulates these timeouts and uses the final value as the timeout for the single `test.wait` call. The `test.resume` call
simply asserts that no errors were returned by the last step executed.

Since thrown exceptions are turned into callback errors, all exceptions including assertions will be returned to the
`resume` function for friendly error reporting.

API
---

### batch = this.batch([defaults])

returns a `TestBatch` object that has a chainable API to add multiple steps, each being a function to be executed.

`defaults` is an optional object with the following supported properties:

  * `timeout`: the default timeout in milliseconds for steps that wait, when an explicit timeout has not been specified (global default is 10 seconds)
  * `shortWait`: the default amount of time in milliseconds for waiting after mouse clicks etc. (global default is 100ms)
  * `poll`: the default polling interval in milliseconds for steps that poll, when an explicit interval has not been specified (global default is 200ms)

#### batch.add(f [, millis])

adds an execution step. The first argument may be a function or another `Batch` to be run.

  * When a function has arity 0, it is assumed to be synchronous and wrapped with an async wrapper
  * When a function has arity 1, it is assumed to be one that accepts a single callback argument.

The optional `millis` parameter specifies the expected worst-case runtime of the function in milliseconds. This is
only honored when you pass a function as the first argument. When ths first argument is a `Batch`, it already has an
expected worst-case runtime associated with it based on the functions that it calls.

#### batch.createBatch([defaults])

creates a secondary batch with potentially different default configuration to which steps may be added.
Note that this secondary batch is not automatically added as a step for this one. You need to `add` it explicitly.

#### batch.run()

runs all the functions added to the batch in series, asynchronously under the `wait` and `resume` methods
of the test associated with this batch.

Subsequent method descriptions should be read as _adds an asynchronous function that ..._

#### batch.wait([timeout])

waits for `timeout` milliseconds or for a default interval (typically 10 seconds).

#### batch.waitUntil(testFn [, timeout [, pollInterval]])

waits up to a maximum of `timeout` milliseconds, polling every `pollInterval` milliseconds running the `testFn`
each time. Returns when the the test function returns true or errors when the timeout is exhausted.

#### batch.waitForElement(selector [,timeout [, pollInterval]])

waits for the DOM node represented by the selector to be present and visible in the DOM tree and errors when the timeout
is exhausted.

#### batch.click(selector)

generates a `click` event on the selector and waits for a small amount of time before returning. Errors when no
node matching the selector is found.

This uses the `node-event-simulate` YUI module to generate a series of events including `mousedown`, `mouseup` etc.
to trigger event handlers that may be listening on these events.

#### batch.setValue(selector, value)

sets `value` as value of the node represented by `selector` and waits for a small amount of time before returning.
Errors when no node matching the selector is found.

This uses the `node-event-simulate` YUI module to generate a series of events including `keydown`, `keyup` etc.
to trigger event handlers that may be listening on these events.

Currently only text input elements are supported by this method.

#### batch.waitAndClick(selector [, timeout])

combination of `waitForElement` and `click` executed in series.

Creating your own sugar functions
---------------------------------

Custom sugar functions may be created using the `extend` method exposed as a class method of the `Batch` class
available as `Y.Test.FunctionalTestCase.Batch`

```javascript
/*globals YUI */
YUI.add('test-helpers', function (Y) {
    var Batch = Y.Test.FunctionalTestCase.Batch;

    Batch.extend('waitForSuccessfulExecution', function () {
        // return an inner batch in which you can do complex stuff
        // `this` refers to the current Batch instance that is calling this method
        // the example below waits for a success overlay to popup and then
        // dismisses it
        return this.createBatch().
            waitForElement('#popup').
            waitForElement('#popup .close').
            wait(100).
            click('#popup .close');
    });

}, "0.1", { requires: [ 'functional-test-case' ]});

```

Now a test method can use this sugar method in its chain as in:

```javascript
    this.batch().
        waitAndClick('#some-button').
        waitForElement('#overlay').
        setValue('#overlay-field', '1000').
        waitAndClick('#overlay-submit').
        waitForSuccessfulExecution().
        run();

```


