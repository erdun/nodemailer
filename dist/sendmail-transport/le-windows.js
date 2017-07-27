'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var stream = require('stream');
var Transform = stream.Transform;

/**
 * Ensures that only <CR><LF> sequences are used for linebreaks
 *
 * @param {Object} options Stream options
 */

var LeWindows = function (_Transform) {
    _inherits(LeWindows, _Transform);

    function LeWindows(options) {
        _classCallCheck(this, LeWindows);

        // init Transform
        var _this = _possibleConstructorReturn(this, (LeWindows.__proto__ || Object.getPrototypeOf(LeWindows)).call(this, options));

        _this.options = options || {};
        _this.lastByte = false;
        return _this;
    }

    /**
     * Escapes dots
     */


    _createClass(LeWindows, [{
        key: '_transform',
        value: function _transform(chunk, encoding, done) {
            var buf = void 0;
            var lastPos = 0;

            for (var i = 0, len = chunk.length; i < len; i++) {
                if (chunk[i] === 0x0A) {
                    // \n
                    if (i && chunk[i - 1] !== 0x0D || !i && this.lastByte !== 0x0D) {
                        if (i > lastPos) {
                            buf = chunk.slice(lastPos, i);
                            this.push(buf);
                        }
                        this.push(new Buffer('\r\n'));
                        lastPos = i + 1;
                    }
                }
            }

            if (lastPos && lastPos < chunk.length) {
                buf = chunk.slice(lastPos);
                this.push(buf);
            } else if (!lastPos) {
                this.push(chunk);
            }

            this.lastByte = chunk[chunk.length - 1];
            done();
        }
    }]);

    return LeWindows;
}(Transform);

module.exports = LeWindows;
