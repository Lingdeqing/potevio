const Chalk = require('chalk')
const Ora = require('ora')
const log = console.log

const Console = {
    green: function (str) {
        log(Chalk.green(str))
    },
    red: function (str) {
        log(Chalk.red(str))
    }
}

const Spinner = function (str, color) {
    if (!(this instanceof Spinner)) return new Spinner(str)
    this._spinner = Ora({
        text: str,
        color: 'white'
    }).start()
}
Spinner.prototype.stop = function (str) {
    this._spinner.text = str
    this._spinner.stop()
}
Spinner.prototype.succeed = function (str) {
    this._spinner.succeed(Chalk.green(str))
}

module.exports = {
    Console,
    Spinner,
    Chalk
}