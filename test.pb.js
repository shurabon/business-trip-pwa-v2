routerAdd("POST", "/api/test-post", function(e) {
    try {
        const info = e.requestInfo();
        return e.json(200, {
            body: info.body,
            headers: info.headers
        });
    } catch (err) {
        return e.json(500, { error: String(err) });
    }
});
