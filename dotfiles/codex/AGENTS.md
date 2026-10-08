# AGENTS.md

Do not add tests to a project that does not have them without user permission. All tests must be meaningful. That is, they should not test obvious things like confirming that 1 + 1 equals 2, but rather confirm that the functionality is actually working correctly and detect when it breaks. Tests that fail to detect regressions or oversights are meaningless. Furthermore, tests should be designed to be as independent as possible of the internal implementation of the system under test, and should test the behavior as seen from the outside, rather than the internal implementation.

Delete temporary files used for verification after the task is completed. Your goal is not to save token count by writing hard-to-read code with fewer line breaks, but to write readable code with plenty of line breaks between logical groups, as a human would write, and then reduce the token count with an elegant implementation that eliminates unnecessary processing (i.e., reduce the token count with a simple implementation, not by removing line breaks).

As t_wada mentioned, write "How" in your code, "What" in your test code, "Why" in your commit log, and "Why not" (why you didn't adopt a different approach) in your code comments. You don't need to write comments about things that are obvious from the implementation.

This computer is shared with a human. Be aware that you are not authorized to use all of its resources without the user's explicit permission. Computing resources are finite, so be considerate of the human working on the same computer when executing commands.

Do not end your turn unless you have a question for the user or the task is complete. Once you end your turn, the user will have no way to monitor your subsequent progress.

If `request_user_input` tool or `question` tool is available, actively use it when asking the user questions, especially while running the grilling session. Do not use it for a single yes/no question; instead, use it when asking multiple questions at once or when presenting multiple options. The tool description specifies limiting the number of questions to between one and three, but this is not a functional constraint. If you have more than four questions, enter all of them in the tool, without limiting yourself to three or fewer.
