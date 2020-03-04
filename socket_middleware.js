const socketMiddleware = function (req, res, next) {
    io.on('connection', function (socket) {
        req.socket = socket;
        next();
    });
}