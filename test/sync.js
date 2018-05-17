const SyncUtil = require('../lib/sync')

var sync = new SyncUtil({
    remoteRegistry: 'https://registry.npmjs.org/',
    syncDependencies: true,
    syncDevDependencies: false
})


// 测试获取匹配的版本号
// var package1 = {
//     'dist-tags': {
//         latest: '3.1.1'
//     },
//     versions: {
//         '1.1.1': {},
//         '2.1.1': {},
//         '2.9.1': {},
//         '3.1.1': {},
//     }
// }
// var package2 = {
//     versions: {
//         '1.1.1': {},
//         '2.1.1': {},
//         '2.9.1': {},
//         '3.1.1': {},
//     }
// }
// var ver = sync.getSatisfyVer(package1, '^2.1.1')
// console.assert(ver === '2.9.1')
// ver = sync.getSatisfyVer(package1)
// console.assert(ver === '3.1.1')
// ver = sync.getSatisfyVer(package1, '^1.1.1')
// console.assert(ver === '1.1.1')
// ver = sync.getSatisfyVer(package1)
// console.assert(ver === '3.1.1')
// ver = sync.getSatisfyVer(package2, '^0.1.1')
// console.assert(ver === '3.1.1')

// 测试获取package
sync.syncPackage('gulp')
// sync.syncPackages([{name: 'express', semver: '0.14.0'},{name: 'express'},{name: 'gulp'}])