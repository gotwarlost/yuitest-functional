set -ex
mkdir -p ./artifacts/test/coverage
./node_modules/.bin/istanbul instrument lib/client/functional-test-case.js -o test/simple/functional-test-case.js
cd test/simple && phantomjs headless.js && cd - && mv test/simple/results.xml ./artifacts/test/ && mv test/simple/coverage.json ./artifacts/test/coverage/
cd artifacts/test && ../../node_modules/.bin/istanbul report lcov && cd -
cd artifacts/test && ../../node_modules/.bin/istanbul report text && cd -
rm test/simple/functional-test-case.js


