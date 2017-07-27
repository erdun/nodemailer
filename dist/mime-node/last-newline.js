'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var Transform = require('stream').Transform;

var LastNewline = function (_Transform) {
    _inherits(LastNewline, _Transform);

    function LastNewline() {
        _classCallCheck(this, LastNewline);

        var _this = _possibleConstructorReturn(this, (LastNewline.__proto__ || Object.getPrototypeOf(LastNewline)).call(this));

        _this.lastByte = false;
        return _this;
    }

    _createClass(LastNewline, [{
        key: '_transform',
        value: function _transform(chunk, encoding, done) {
            if (chunk.length) {
                this.lastByte = chunk[chunk.length - 1];
            }

            this.push(chunk);
            done();
        }
    }, {
        key: '_flush',
        value: function _flush(done) {
            if (this.lastByte === 0x0A) {
                return done();
            }
            if (this.lastByte === 0x0D) {
                this.push(Buffer.from('\n'));
                return done();
            }
            this.push(Buffer.from('\r\n'));
            return done();
        }
    }]);

    return LastNewline;
}(Transform);

module.exports = LastNewline;
