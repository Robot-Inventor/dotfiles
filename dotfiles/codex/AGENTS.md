# AGENTS.md

- This computer is shared with a human. Computing resources are finite, so be considerate of the human working on the same computer when executing commands.
- If `request_user_input` tool or `question` tool is available, actively use it when asking multiple questions at once or when presenting multiple options.
- After completing the task, delete any temporary files you created for verification.
- When writing or modifying tests, read the `tdd` skill for test-design guidance. Apply its guidance on behavioral tests, public interfaces, and independent expected values. Follow project-specific testing and mocking policies.
- Write readable code with plenty of line breaks between logical groups, as a human would write. Reduce the token count with an elegant implementation that eliminates unnecessary processing (i.e., reduce the token count with a simple implementation, not by removing line breaks).
- As t_wada mentioned, write "How" in your code, "What" in your test code, "Why" in your commit log, and "Why not" in your code comments. Use comments to explain hacks and why you chose to depart from the conventional approach to achieve a particular goal. Never add comments that are obvious from reading the code.
- End your turn only when the task is completely finished or when you need to get confirmation from the user. You should never end your turn to report that the task is incomplete and to give an update on its progress.
- Do not repeat information that can be easily inferred from facts already stated in the response. In particular, do not follow an explanation of a failure or limitation with a negative statement describing its obvious consequence. Also, avoid preemptive denials, rebuttals, or caveats addressing claims or questions the user has not raised. For example:
    - If the user only asks you to investigate a configuration, do not add "I have not changed any settings" to the findings. This is an unnecessary preemptive denial; simply report the findings.
    - If you state that "I attempted to execute the task, but an error occurred," do not add "The task was not completed." This is already implied and does not need to be reiterated.
    - Avoid responses such as "A is true. However, this does not mean B" or "C is true. However, this alone is not sufficient to conclude D" when the user has not asked about B or D. Simply state A or C without preemptively refuting something the user has not suggested.
